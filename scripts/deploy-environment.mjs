// Workers Builds pins Wrangler to its connected Worker via these two values.
// Keep that protection for the site, and remove it only in the child process
// that deliberately deploys the separately named music service.
export function deploymentEnvironment(environment,{siteName,targetName}){
  if(!siteName||!targetName)throw Error('Deployment requires explicit Worker names');
  const expected=environment.WRANGLER_CI_OVERRIDE_NAME;
  if(expected&&expected!==siteName){
    throw Error(`This deployment must run in the ${siteName} build, but CI is connected to ${expected}. No Worker was deployed.`);
  }
  const child={...environment};
  if(targetName!==siteName){
    delete child.WRANGLER_CI_OVERRIDE_NAME;
    delete child.WRANGLER_CI_MATCH_TAG;
  }
  return child;
}
