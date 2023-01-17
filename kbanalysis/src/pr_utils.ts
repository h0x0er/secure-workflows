import {exec } from "child_process";
import * as core from "@actions/core";
import { writeFile, writeFileSync } from "fs";



function terminal(cmd:string){
    exec(cmd, async (error, stdout, stderr)=>{

        if(error){core.warning(`Error occurred: ${error}`)}
        if(stderr){core.warning(`Error occurred: ${stderr}`)}
        if(stdout){core.info(`Output: ${stdout}`)}


    })  
}

export function createActionYaml(owner:string, repo:string, content:string){
    let path = `knowledge-base/actions/${owner.toLocaleLowerCase()}/${repo.toLocaleLowerCase()}`
    terminal(`mkdir -p ${path}`)
    terminal(`touch ${path}/action-security.yml`)
    terminal(`ls ${path}`)
    writeFileSync(`${path}/action-security.yml`, content);
}