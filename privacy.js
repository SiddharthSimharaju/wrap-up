(function(){
  var e=(window.APP_CONFIG&&window.APP_CONFIG.contactEmail||"").trim();
  var a=document.getElementById("mail");
  if(e&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){a.href="mailto:"+e;a.textContent=e;}
})();
