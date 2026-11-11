(function () {
  const footer = document.createElement('footer');
  footer.className = 'mps-footer';
  footer.innerHTML = '' +
    '<div class="mps-footer-links"><ul>' +
      '<li><b>相关链接</b></li>' +
      '<li><a href="http://www.gov.cn/" target="_blank" rel="noopener noreferrer">中国政府网</a></li>' +
      '<li><a href="http://www.chinapeace.gov.cn/" target="_blank" rel="noopener noreferrer">中国长安网</a></li>' +
      '<li><a href="http://www.court.gov.cn/" target="_blank" rel="noopener noreferrer">最高人民法院</a></li>' +
      '<li><a href="https://www.spp.gov.cn/" target="_blank" rel="noopener noreferrer">最高人民检察院</a></li>' +
      '<li><a href="https://www.nia.gov.cn/" target="_blank" rel="noopener noreferrer">国家移民管理局</a></li>' +
    '</ul></div>' +
    '<div class="mps-footer-bar"><div class="mps-footer-bar-inner">' +
      '<p>主办单位：中华人民共和国公安部　版权所有：中华人民共和国公安部　地址：北京市东长安街14号　邮编：100741</p>' +
      '<p><a href="http://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">京ICP备05070602号</a>　<a href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=11010102000001" target="_blank" rel="noopener noreferrer">京公网安备11010102000001号</a>　网站标识码：bm09000013</p>' +
    '</div></div>';
  const style = document.createElement('style');
  style.textContent = '' +
    '.mps-footer{margin-top:28px;background:#fff;color:#4f75dc;font-size:14px;}' +
    '.mps-footer a{color:#4f75dc;text-decoration:none;}' +
    '.mps-footer a:hover{color:#103289;}' +
    '.mps-footer-links{width:min(1100px,calc(100% - 32px));margin:0 auto;}' +
    '.mps-footer-links ul{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;margin:0;padding:16px 0;list-style:none;}' +
    '.mps-footer-links b{color:#222;}' +
    '.mps-footer-bar{background:#103289;}' +
    '.mps-footer-bar-inner{width:min(1060px,calc(100% - 32px));margin:0 auto;padding:16px 0 18px;color:#4f75dc;font-size:12px;line-height:25px;}' +
    '.mps-footer-bar p{margin:0;}';
  const old = document.querySelector('footer.site-footer');
  if (old) old.replaceWith(footer);
  else document.body.appendChild(footer);
  document.head.appendChild(style);
})();
