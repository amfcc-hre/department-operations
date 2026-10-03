import { createClient } from "@supabase/supabase-js";

const BUCKET = "it-technical-documents";
const LIMIT = 20 * 1024 * 1024;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const mime: Record<string,string> = { pdf:"application/pdf",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
function reply(body:unknown,status=200) { return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}}); }
function client() { return createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}}); }
function validUuid(value:unknown) { return typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export async function handle(request:Request) {
 if(request.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(request.method==="GET") return reply({status:"ready"});
 if(request.method!=="POST") return reply({status:"invalid",message:"POST is required."},405);
 try {
  const admin=client();
  const isUpload=(request.headers.get("content-type")||"").includes("multipart/form-data");
  const input=isUpload?await request.formData():await request.json();
  const get=(key:string):unknown=>isUpload?(input as FormData).get(key):(input as Record<string,unknown>)[key];
  const token=get("session_token");
  if(typeof token!=="string" || token.length<32 || token.length>300) return reply({status:"unauthorized",message:"Sign in to your workspace again."},401);
  const versionId=isUpload?null:get("version_id");
  if(!isUpload && !validUuid(versionId)) return reply({status:"invalid",message:"Choose a document version."},400);
  const {data:access,error:authError}=await admin.rpc("ops_it_document_authorize",{p_session_token:token,p_write:isUpload,p_version_id:versionId});
  if(authError) return reply({status:authError.code==="28000"?"unauthorized":"forbidden",message:authError.message},authError.code==="28000"?401:403);
  if(!isUpload) {
   const v=access.version;
   // A download is streamed after session validation, with no reusable public link.
   const {data:file,error}=await admin.storage.from(BUCKET).download(v.storage_path);
   if(error || !file) return reply({status:"error",message:"The document could not be opened. Try again."},404);
   return new Response(file,{headers:{...cors,"Content-Type":v.mime_type,"Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(v.file_name),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }
  const file=get("file");
  if(!(file instanceof File)||!file.size||file.size>LIMIT) return reply({status:"invalid",message:"Choose a PDF or Word document up to 20 MB."},400);
  const original=file.name.normalize("NFKC"), ext=original.split(".").pop()?.toLowerCase()||"";
  if(!mime[ext]) return reply({status:"invalid",message:"Only PDF, DOC and DOCX documents can be imported."},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const valid=ext==="pdf"?new TextDecoder().decode(bytes.slice(0,5))==="%PDF-":ext==="docx"?bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4:[208,207,17,224,161,177,26,225].every((v,i)=>bytes[i]===v);
  if(!valid) return reply({status:"invalid",message:"This file does not match its document format. Export it as a PDF or Word document and try again."},400);
  const existing=get("document_id");
  if(existing && !validUuid(existing)) return reply({status:"invalid",message:"Choose a valid document."},400);
  const did=existing?String(existing):crypto.randomUUID(), vid=crypto.randomUUID();
  const expected=get("expected_current_version_id")||null;
  if(expected && !validUuid(expected)) return reply({status:"invalid",message:"Refresh the document register and try again."},400);
  const title=String(get("title")||"").trim(),section=String(get("section")||""),category=String(get("category")||"").trim(),type=String(get("document_type")||"");
  const note=String(get("change_note")||"").trim();
  if(!existing && (!title || title.length>300 || !["how_to","specification"].includes(section) || !category || category.length>100 || !["SOP","Troubleshooting guide","Reference","Technical specification"].includes(type))) return reply({status:"invalid",message:"Complete the document title, section, category and type."},400);
  if(note.length>2000 || existing&&!note) return reply({status:"invalid",message:"Describe what changed, using up to 2,000 characters."},400);
  const name=original.replace(/[\x00-\x1f/\\]/g,"_").slice(-240);
  const path=did+"/"+vid+"/"+name;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const {error:uploadError}=await admin.storage.from(BUCKET).upload(path,bytes,{contentType:mime[ext],upsert:false,cacheControl:"0"});
  if(uploadError) return reply({status:"error",message:"Upload failed. Your current document has not changed. Try again."},500);
  const {data:saved,error:saveError}=await admin.rpc("ops_it_document_commit_version",{p_session_token:token,p_payload:{document_id:did,version_id:vid,expected_current_version_id:expected,title,section,category,document_type:type,change_note:note,storage_path:path,file_name:name,file_size:bytes.length,mime_type:mime[ext],sha256:hash}});
  if(saveError || saved?.status!=="success") {
   await admin.storage.from(BUCKET).remove([path]);
   return reply(saved||{status:saveError?.code==="28000"?"unauthorized":"error",message:saveError?.code==="28000"?"Your session ended. Sign in again.":"The version could not be saved. Your current document has not changed."},saved?.status==="conflict"?409:400);
  }
  return reply(saved);
 } catch { return reply({status:"error",message:"The document request failed. Check your connection and try again."},500); }
}
Deno.serve(handle);
