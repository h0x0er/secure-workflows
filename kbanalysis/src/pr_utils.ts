import {exec } from "child_process";
import * as core from "@actions/core";
import { writeFileSync, appendFileSync } from "fs";



function terminal(cmd:string){
    exec(cmd, async (error, stdout, stderr)=>{

        if(error){core.warning(`Error occurred: ${error}`)}
        if(stderr){core.warning(`Error occurred: ${stderr}`)}
        if(stdout){core.info(`Output: ${stdout}`)}


    })  
}

export function createActionYaml(owner:string, repo:string, content:string){
    let path = `./knowledge-base/actions/${owner.toLocaleLowerCase()}/${repo.toLocaleLowerCase()}`
    let repo_file = `action-security.yml`
    let full_path = `${path}/${repo_file}`
  
    // terminal(`mkdir -p ${path}`)

    // terminal(`touch ${full_path}`)
    // appendFileSync(full_path, content, {})
    appendFileSync(full_path, content, {flag:"a+"});
}