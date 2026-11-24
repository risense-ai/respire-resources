import {EventEmitter,once} from "node:events";
import {Readable} from "node:stream";
import {server} from "./server.mjs";

export const local = {authorization:"Bearer synthetic-preview-only","content-type":"application/json"};
export const proofHeaders = challenge => ({"x-respire-handshake-proof":"synthetic-owner-proof-" + challenge});
export function harness(interval = 2) {
  const app = server({interval});
  app.address = ()=>({port:4173});
  async function call(method,url,body,headers = local) {
    const bytes = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))];
    const req = Object.assign(Readable.from(bytes),{method,url,headers:{host:"127.0.0.1:4173",...headers}});
    const res = new EventEmitter();
    const fields = {}, chunks = [];
    res.setHeader = (key,value)=>{fields[key.toLowerCase()] = value;};
    res.writeHead = (status,extra={})=>{res.status = status; for (const [key,value] of Object.entries(extra)) res.setHeader(key,value); return res;};
    res.write = data=>chunks.push(Buffer.from(data));
    res.end = data=>{if (data !== undefined) res.write(data); res.emit("close");};
    const ended = once(res,"close");
    app.emit("request",req,res);
    await ended;
    const bytesOut = Buffer.concat(chunks);
    return {status:res.status,headers:fields,bytes:bytesOut,text:bytesOut.toString(),json:()=>JSON.parse(bytesOut)};
  }
  return {call,close:()=>app.emit("close")};
}
