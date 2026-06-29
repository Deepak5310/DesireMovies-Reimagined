"use strict";

document.getElementById("settingsBtn").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options/options.html"));
  }
});

const logsContainer = document.getElementById("logsContainer");

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logsContainer.innerHTML = '<div class="empty">No recent bypass activity.</div>';
    return;
  }

  logsContainer.innerHTML = "";
  
  // Render logs (newest first, which is how we'll store them or we can reverse)
  logs.forEach(log => {
    const el = document.createElement("div");
    el.className = "log-item";
    
    let statusClass = "status-info";
    let statusIcon = "ℹ️";
    
    if (log.status === "success") {
      statusClass = "status-success";
      statusIcon = "✅";
    } else if (log.status === "error") {
      statusClass = "status-error";
      statusIcon = "❌";
    } else if (log.status === "warning") {
      statusClass = "status-warning";
      statusIcon = "⚠️";
    }

    const date = new Date(log.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    el.innerHTML = `
      <div class="log-header">
        <span class="${statusClass}">${statusIcon} ${log.title}</span>
        <span class="log-time">${timeStr}</span>
      </div>
      <div class="log-msg">${log.message}</div>
    `;
    logsContainer.appendChild(el);
  });
}

// Load logs on open
chrome.storage.local.get(["bypassLogs"], (data) => {
  renderLogs(data.bypassLogs || []);
});

// Update if new logs arrive while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.bypassLogs) {
    renderLogs(changes.bypassLogs.newValue || []);
  }
});
