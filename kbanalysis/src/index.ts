import * as core from "@actions/core"
import * as github from "@actions/github"
import { existsSync, fstat, readFileSync } from "fs";
import { exit } from "process";
import { handleKBIssue } from "./issues-util";
import { createActionYaml } from "./pr_utils";
import { isKBIssue, getAction, getActionYaml, findToken, printArray, comment, getRunsON, getReadme, checkDependencies, findEndpoints, permsToString, isValidLang, actionSecurity, getTokenInput, normalizePerms, isPaused} from "./utils"

try{


    const token = core.getInput("github-token");
    const client = github.getOctokit(token) // authenticated octokit

    const repos = github.context.repo // context repo
    const event = github.context.eventName
    

    if(event === "workflow_dispatch"){
        let owner = core.getInput("owner");
        let repo = core.getInput("repo");
        
        let type = core.getInput("state");
        core.info(`State: ${type}`)

        if(type === "analysis"){

            core.info("[+] Need to perform analysis")
            let issue_id; // PR_ ID
            let title = "";
            let marker = `${owner}/${repo}`
            try{
                let repos_result = await client.rest.pulls.list({owner: "h0x0er", repo: "kb_setup", state: "open", per_page: 100, base:"knowledge-base"}) 
                for(let pull of repos_result.data){
                    core.info(`[+] Found: ${pull.title}`)
                    if(pull.title.indexOf(marker) > -1){
                        issue_id = pull.id;
                        title = pull.title;
                        break;
                    }
                }
            }catch(err){
                core.setFailed(err)
            }
            
            core.info(`Title: ${title}`);
            if(!isKBIssue(title)){
                core.info("Not performing analysis as issue is not a valid KB issue")
                core.setFailed("PR is not valid");
            }
        
            const action_name: String = getAction(title) // target action
            const action_name_split = action_name.split("/") 
            const target_owner = action_name_split[0]
        
            // target_repo is the full path to action_folder
            //  i.e github.com/owner/someRepo/someActionPath
            const target_repo = action_name_split.length > 2 ? action_name_split.slice(1,).join("/") : action_name_split[1]


            if(existsSync(`knowledge-base/actions/${target_owner.toLocaleLowerCase()}/${target_repo.toLocaleLowerCase()}/action-security.yml`)){
                core.info("Not performing analysis as issue is already analyzed")
                exit(0)
            }
        
            core.info("===== Performing analysis =====")
            
            const repo_info = await client.rest.repos.get({owner:target_owner, repo: target_repo.split("/")[0]}) // info related to repo.
            
            let lang:String = ""
            try{
                const langs = await client.rest.repos.listLanguages({owner:target_owner, repo:target_repo})
                lang = Object.keys(langs.data)[0] // top language used in repo
            }catch(err){
                lang = "NOT_FOUND"
            }
            
            core.info(`Issue Title: ${title}`)
            core.info(`Action: ${action_name}`) 
            core.info(`Top language: ${lang}`)
            core.info(`Stars: ${repo_info.data.stargazers_count}`)
            core.info(`Private: ${repo_info.data.private}`)
        
            try{
                const action_data = await getActionYaml(client, target_owner, target_repo)
                const readme_data = await getReadme(client, target_owner, target_repo)
        
                const start = action_data.indexOf("name:")
                const action_yaml_name = action_data.substring(start, start+action_data.substring(start,).indexOf("\n"))
        
                const action_type = getRunsON(action_data)
                core.info(`Action Type: ${action_type}`)
        
                // determining if token is being set by default
                const pattern = /\${{.*github\.token.*}}/ // default github_token pattern
                const is_default_token = action_data.match(pattern) !== null
        
                let matches:String[] = [] // // list holding all matches.
                const action_matches = await findToken(action_data) 
                if(readme_data !== null){
                    const readme_matches = await findToken(readme_data)
                    if(readme_matches !== null){
                        matches.push(...readme_matches) // pushing readme_matches in main matches.
                    }
                }
                if(action_matches !== null){
                    matches.push(...action_matches)
                }
                if(matches.length === 0){
                    // no github_token pattern found in action_file & readme file 
                    core.warning("Action doesn't contains reference to github_token")
                    const template = `\n\`\`\`yaml\n${action_yaml_name} # ${target_owner+"/"+target_repo}\n# GITHUB_TOKEN not used\n\`\`\`\n`
                    const action_yaml_content = `${action_yaml_name} # ${target_owner+"/"+target_repo}\n# GITHUB_TOKEN not used\n`
                    await createActionYaml(target_owner, target_repo, action_yaml_content)
        
                    await comment(client, repos, Number(issue_id), "This action's `action.yml` & `README.md` doesn't contains any reference to GITHUB_TOKEN\n### action-security.yml\n"+template)
                }else{
                    // we found some matches for github_token
                    matches = matches.filter((value, index, self)=>self.indexOf(value)===index) // unique matches only.
                    core.info("Pattern Matches: "+matches.join(","))
                    
                    if(lang === "NOT_FOUND" || action_type === "Docker" || action_type === "Composite"){
                        // Action is docker or composite based no need to perform token_queries
                        const body = `### Analysis\n\`\`\`yml\nAction Name: ${action_name}\nAction Type: ${action_type}\nGITHUB_TOKEN Matches: ${matches}\nStars: ${repo_info.data.stargazers_count}\nPrivate: ${repo_info.data.private}\nForks: ${repo_info.data.forks_count}\n\`\`\``
                        await comment(client, repos, Number(issue_id), body)
        
                    }else{
                        // Action is Node Based
                        let is_used_github_api = false 
                        if(isValidLang(lang)){
                            is_used_github_api =  await checkDependencies(client, target_owner, target_repo)
                        }
                        core.info(`Github API used: ${is_used_github_api}`)
                        let paths_found = [] // contains url to files
                        let src_files = [] // contains file_paths relative to repo.
        
                        for(let match of matches){
                            const query = `${match}+in:file+repo:${target_owner}/${target_repo}+language:${lang}`
                            const res = await client.rest.search.code({q: query})
                            
                            const items = res.data.items.map(item=>item.html_url)
                            const src = res.data.items.map(item=>item.path)
                            
                            paths_found.push(...items)
                            src_files.push(...src)
                        }
                        
                        const filtered_paths = paths_found.filter((value, index, self)=>self.indexOf(value)===index)
                        src_files = src_files.filter((value, index, self)=>self.indexOf(value)===index) // filtering src files.
                        core.info(`Src File found: ${src_files}`)
                        let body = `### Analysis\n\`\`\`yml\nAction Name: ${action_name}\nAction Type: ${action_type}\nGITHUB_TOKEN Matches: ${matches}\nTop language: ${lang}\nStars: ${repo_info.data.stargazers_count}\nPrivate: ${repo_info.data.private}\nForks: ${repo_info.data.forks_count}\n\`\`\``
                        
        
                        let action_security_yaml = ""
                        const valid_input = getTokenInput(action_data, matches)
                        let token_input = valid_input !== "env_var" ? `action-input:\n    input: ${valid_input}\n    is-default: ${is_default_token}` : `environment-variable-name: <FigureOutYourself>`
        
                        if(is_used_github_api){
                            if(src_files.length !== 0){
                                body += "\n### Endpoints Found\n"
                                const perms = await findEndpoints(client, target_owner, target_repo, src_files)
                                if(perms !== {}){
                                    let str_perms = permsToString(perms)
                                    body += str_perms
                                    core.info(`${str_perms}`)
                                    action_security_yaml += actionSecurity({name:action_yaml_name, token_input: token_input, perms:normalizePerms(perms)})
        
        
                                }
        
                            }
                            
                        }
        
                        if(filtered_paths.length !== 0){
                            body += `\n#### FollowUp Links.\n${filtered_paths.join("\n")}\n`
        
                        }
        
                        body += "\n### action-security.yml\n"+action_security_yaml
        
                        await comment(client, repos, Number(issue_id), body)
                        
                        printArray(filtered_paths, "Paths Found: ")
                    }
    

        }
            exit(0);




            }catch(err){
                core.setFailed(err)
            }
        }
        // Creating PR for missing KB
        if(owner !== "" && repo !== ""){

            if(existsSync(`knowledge-base/actions/${owner.toLocaleLowerCase()}/${repo.toLocaleLowerCase()}`)){
                core.info(`[!] KB already exists for ${owner}/${repo}`);
                exit(0);
            }
            let content = [];
            content.push(`# Add permissions for ${owner}/${repo}`);
            content.push(`# Info: Checkout the analysis comment to see info.`);
            createActionYaml(owner, repo, content.join("\n"));
            core.info(`[+] Created action-security.yaml for ${owner}/${repo}`);
            
            try{

            const resp2 = await client.rest.actions.createWorkflowDispatch({
                owner: "h0x0er",
                repo: "kb_setup",
                workflow_id: "analysis.yml",
                ref: "master",
                inputs: {state: "analysis", owner: owner, repo: repo}
            });

            core.info(`[+] Status: ${resp2.status}`)

            }catch(err){
                core.info(err)
            }

            

            exit(0);

        }
    
    }

    if(event === "schedule"){
        core.info(`[!] Launched by ${event}`)
        
        const label = "knowledge-base";
        const owner = "h0x0er"
        const repo = "kb_setup"
        let issues = [];
        const resp = await client.rest.issues.listForRepo({owner:owner, repo:repo, labels: label, state: "open", per_page:100});

        const status = resp.status;
        if (status === 200){
            for(let issue of resp.data){
                issues.push({title:issue.title, number:issue.number});
            }
        }
        if(issues.length > 0){
            for(let issue of issues){
                const t = await handleKBIssue(client, owner, repo, issue);
            }
            core.info(`[!] Moved ${issues.length} issues`)
            exit(0);
        }else{
            core.info("No KB issues found");
        }
        
        core.info(`[X] Unable to list KB issues`)
        exit(0);
    }


}catch(err){
    core.setFailed(err)
}

