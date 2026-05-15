// 点击扩展图标时，向当前 Jira 标签页发送 Alt+R 等价的报告唤起调用
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !/^https:\/\/jira\.cjdropshipping\.cn\//.test(tab.url || "")) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        if (typeof window.__tm_generateReport === "function") {
          window.__tm_generateReport();
        } else if (typeof window.__tm_openSettings === "function") {
          window.__tm_openSettings();
        }
      },
    });
  } catch (e) {
    console.warn("[TM-Report] action click failed", e);
  }
});
