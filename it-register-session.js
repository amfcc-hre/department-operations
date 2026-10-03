(function(){
 "use strict";
 var session,client,redirected=false;
 function login(){if(redirected)return;redirected=true;sessionStorage.removeItem("amfcc_ops_session");document.getElementById("register-signout").hidden=true;restrict("Sign in to your IT Department, School Administration or Management workspace to open this register.");document.getElementById("register-state").textContent="Sign in required";}
 function restrict(text){document.getElementById("register-content").hidden=true;var box=document.getElementById("register-access-error");box.hidden=false;box.querySelector("p").textContent=text;document.getElementById("register-state").textContent="Access restricted";}
 async function rpc(name,params){var result=await client.rpc(name,params||{});if(result.error){if(result.error.code==="28000"){login();}else if(result.error.code==="42501"){restrict(result.error.message);}throw result.error;}if(result.data&&result.data.status==="unauthorized"){login();throw new Error(result.data.message||"Sign in again.");}return result.data;}
 async function files(body){var headers={"apikey":window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY};var payload;if(body instanceof FormData){body.set("session_token",session.session_token);payload=body;}else{headers["Content-Type"]="application/json";payload=JSON.stringify(Object.assign({},body,{session_token:session.session_token}));}
  var response=await fetch(window.APP_CONFIG.SUPABASE_URL+"/functions/v1/it-document-files",{method:"POST",headers:headers,body:payload,cache:"no-store"});
  if(!response.ok){var error=await response.json().catch(function(){return{};});if(error.status==="unauthorized")login();if(error.status==="forbidden")restrict(error.message);throw new Error(error.message||"The document request failed. Try again.");}return response;
 }
 async function ready(){
  try{session=JSON.parse(sessionStorage.getItem("amfcc_ops_session")||"null");}catch(error){session=null;}
  if(!session||!session.session_token){login();return null;}
  if(!window.supabase||!window.APP_CONFIG){restrict("The connection could not be loaded. Refresh this page to try again.");return null;}
  client=window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  document.getElementById("register-signout").addEventListener("click",async function(){this.disabled=true;try{await client.rpc("ops_logout",{p_session_token:session.session_token});}finally{sessionStorage.removeItem("amfcc_ops_session");window.location.replace("index.html");}});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});
  try{var initial=await rpc(document.body.dataset.itRegister==="assets"?"ops_it_assets_bootstrap":"ops_it_documents_bootstrap",{p_session_token:session.session_token});
   if(!initial||initial.status!=="success")throw new Error(initial&&initial.message||"The register could not be loaded.");
   document.getElementById("register-state").textContent=session.display_name||({administrator:"School Administration",management:"Management"}[session.role]||"IT Department");
   document.getElementById("register-content").hidden=false;
   return{session:session,client:client,rpc:rpc,files:files,initial:initial};
  }catch(error){if(!redirected)restrict(error.message||"The register could not be loaded. Refresh to try again.");return null;}
 }
 window.AMFCCRegisterReady=ready();
})();
