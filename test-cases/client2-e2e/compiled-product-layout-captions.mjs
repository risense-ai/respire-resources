import assert from "node:assert/strict";

// Exact 505ecc4 product messages/translation phrases; no browser rewrite.
const captions = {
  diary: ["h1","Keep daily activity on a calendar.","\u628a\u65e5\u5e38\uff0c\u7559\u5728\u65e5\u5386\u91cc\u3002"],
  accounts: ["h1","Account & workspace","\u8d26\u6237\u4e0e\u5de5\u4f5c\u533a"],
  overview: ["h1","Memory, always ready.","\u8bb0\u5fc6\uff0c\u4fdd\u6301\u5c31\u7eea\u3002"],
  workspace: ["h1","Your memory, clearly visible.","\u4f60\u7684\u8bb0\u5fc6\uff0c\u6e05\u6670\u53ef\u89c1\u3002"],
  recall: ["[data-count]","Retrieved 1; search covers all memories","\u68c0\u7d22\u8fd4\u56de 1 \u6761\uff1b\u641c\u7d22\u8986\u76d6\u6574\u5e93"],
  storage: [".panel-heading h2","Runtime data directory","Runtime \u6570\u636e\u76ee\u5f55"],
  settings: ["h1","Settings","\u8bbe\u7f6e"]
};
export function pinnedProductCaption(screen,locale){
  assert(Object.hasOwn(captions,screen)&&["en","zh"].includes(locale));
  const [selector,en,zh]=captions[screen];
  return Object.freeze({selector,text:locale==="en"?en:zh});
}
