import {requestID} from "./quick-panel-adapter.mjs";

const failureCodes=new Map([
  ["net::ERR_ABORTED","aborted"],["ERR_ABORTED","aborted"],["NS_BINDING_ABORTED","binding-aborted"],
  ["Load request cancelled","webkit-cancelled"],["cancelled","webkit-cancelled"],
  ["net::ERR_FAILED","failed"],["net::ERR_BLOCKED_BY_CLIENT","blocked-client"],
  ["net::ERR_BLOCKED_BY_RESPONSE","blocked-response"],["net::ERR_CONNECTION_REFUSED","connection-refused"],
  ["net::ERR_CONNECTION_RESET","connection-reset"],["net::ERR_TIMED_OUT","timed-out"],
  ["net::ERR_NAME_NOT_RESOLVED","dns"],["net::ERR_ADDRESS_UNREACHABLE","unreachable"],
]);
const types=new Set(["document","script","stylesheet","font","image","fetch","xhr","other"]);

export function createRequestDiagnostics(origin,assets){
  // Asset ordinal is stable under this independently pinned bundle's inventory.
  // Do not log a pathname, query value, hash fragment, header, request ID or body.
  const assetIDs=new Map([...assets.keys()].sort().slice(0,1024).map((name,index)=>[
    "/"+name,String(index+1).padStart(4,"0"),
  ]));
  return request=>{
    const method=request.method();
    const resource=types.has(request.resourceType())?request.resourceType():"other";
    let path="";
    try{
      const url=new URL(request.url());
      if(url.origin===origin&&!url.search&&!url.hash)path=url.pathname;
    }catch{/* Unclassifiable request stays classified as other. */}
    const route=requestID(method,path);
    const asset=assetIDs.get(path);
    const id=asset&&route.endsWith(":other")?route.replace(/:other$/,":asset-"+asset):route;
    return id+":"+resource+":"+(failureCodes.get(request.failure()?.errorText)??"unclassified");
  };
}
