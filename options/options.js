"use strict";

const movieInput = document.getElementById("movieInput");
const bypassInput = document.getElementById("bypassInput");
const addMovieBtn = document.getElementById("addMovieBtn");
const addBypassBtn = document.getElementById("addBypassBtn");
const movieList = document.getElementById("movieList");
const bypassList = document.getElementById("bypassList");
const statusMsg = document.getElementById("statusMessage");

let dynamicDomains = {
  movies: [],
  bypass: []
};

// ─── UI Helpers ─────────────────────────────────────────────────────────────

function showStatus(msg, type = "success") {
  statusMsg.textContent = msg;
  statusMsg.className = `status ${type}`;
  setTimeout(() => {
    statusMsg.style.display = "none";
  }, 4000);
}

function renderLists() {
  movieList.innerHTML = "";
  bypassList.innerHTML = "";

  const movieFrag = document.createDocumentFragment();
  dynamicDomains.movies.forEach(domain => {
    const li = document.createElement("li");
    li.className = "domain-item";
    li.innerHTML = `
      <span>${domain}</span>
      <button class="danger" data-type="movies" data-domain="${domain}">Remove</button>
    `;
    movieFrag.appendChild(li);
  });
  movieList.appendChild(movieFrag);

  const bypassFrag = document.createDocumentFragment();
  dynamicDomains.bypass.forEach(domain => {
    const li = document.createElement("li");
    li.className = "domain-item";
    li.innerHTML = `
      <span>${domain}</span>
      <button class="danger" data-type="bypass" data-domain="${domain}">Remove</button>
    `;
    bypassFrag.appendChild(li);
  });
  bypassList.appendChild(bypassFrag);
}

// ─── Storage & Init ─────────────────────────────────────────────────────────

async function loadData() {
  const data = await chrome.storage.local.get(["dynamicDomains"]);
  if (data.dynamicDomains) {
    dynamicDomains = data.dynamicDomains;
  }
  renderLists();
}

async function saveData() {
  await chrome.storage.local.set({ dynamicDomains });
  renderLists();
}

// ─── Domain Management ──────────────────────────────────────────────────────

async function addDomain(type, pattern) {
  if (!pattern || !pattern.includes("://")) {
    showStatus("Invalid format. Use *://*.example.com/*", "error");
    return;
  }

  try {
    // 1. Request host permissions from Chrome
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      showStatus("Permission denied by user.", "error");
      return;
    }

    // 2. Register dynamic content script
    const scriptId = `dynamic_${type}_${pattern.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const scriptConfig = {
      id: scriptId,
      matches: [pattern],
      js: [type === "movies" ? "content.js" : "automation.js"],
      runAt: type === "movies" ? "document_idle" : "document_start"
    };

    // Unregister if it already exists to avoid errors
    try { await chrome.scripting.unregisterContentScripts({ ids: [scriptId] }); } catch (e) {}
    
    await chrome.scripting.registerContentScripts([scriptConfig]);

    // 3. Save to storage
    if (!dynamicDomains[type].includes(pattern)) {
      dynamicDomains[type].push(pattern);
      await saveData();
    }

    showStatus(`Successfully added ${pattern}!`);
    movieInput.value = "";
    bypassInput.value = "";

  } catch (err) {
    console.error(err);
    showStatus(`Error: ${err.message}`, "error");
  }
}

async function removeDomain(type, pattern) {
  try {
    const scriptId = `dynamic_${type}_${pattern.replace(/[^a-zA-Z0-9]/g, "_")}`;
    
    // 1. Unregister script
    try { await chrome.scripting.unregisterContentScripts({ ids: [scriptId] }); } catch (e) {}

    // 2. Remove host permission
    await chrome.permissions.remove({ origins: [pattern] });

    // 3. Remove from storage
    dynamicDomains[type] = dynamicDomains[type].filter(d => d !== pattern);
    await saveData();

    showStatus(`Removed ${pattern}`);
  } catch (err) {
    console.error(err);
    showStatus(`Error removing: ${err.message}`, "error");
  }
}

// ─── Event Listeners ────────────────────────────────────────────────────────

addMovieBtn.addEventListener("click", () => addDomain("movies", movieInput.value.trim()));
addBypassBtn.addEventListener("click", () => addDomain("bypass", bypassInput.value.trim()));

document.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON" && e.target.classList.contains("danger")) {
    const type = e.target.getAttribute("data-type");
    const domain = e.target.getAttribute("data-domain");
    removeDomain(type, domain);
  }
});

loadData();
