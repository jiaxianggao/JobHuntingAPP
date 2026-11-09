import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const browserPath = process.argv[2];
if (!browserPath) throw new Error("Pass the path to Chrome or Edge.");
const folder = await mkdtemp(join(tmpdir(), "job-hunt-browser-"));
const profile = join(folder, "profile");
const db = join(folder, "roles.sqlite3");
const original = join(folder, "Sample CV.txt");
let browser;
let server;
let socket;

async function retry(action) {
  let error;
  for (let i = 0; i < 100; i++) {
    try { return await action(); } catch (failure) { error = failure; }
    await delay(100);
  }
  throw error;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function startServer(port = 0) {
  server = spawn("python", ["-B", "-u", "-c",
    "import sys; from pathlib import Path; from server import create_server; s = create_server(Path(sys.argv[1]), int(sys.argv[2])); print(s.server_port); s.serve_forever()",
    db, String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  const [chunk] = await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(([code]) => { throw new Error("Local server exited before startup with code " + code); }),
  ]);
  return Number(chunk.toString().trim());
}

try {
  let port = await startServer();
  const origin = "http://127.0.0.1:" + port;
  browser = spawn(browserPath, [
    "--headless=new", "--no-first-run", "--disable-background-networking",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore" });
  const debugPort = await retry(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]);
  const targets = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const outsideRequests = [];
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === "Network.requestWillBeSent") {
      const url = response.params.request.url;
      if (/^https?:/.test(url) && new URL(url).origin !== origin) outsideRequests.push(url);
    }
    if (pending.has(response.id)) {
      pending.get(response.id)(response);
      pending.delete(response.id);
    }
  });
  async function call(method, params = {}) {
    const messageId = ++id;
    const reply = new Promise((resolve) => pending.set(messageId, resolve));
    socket.send(JSON.stringify({ id: messageId, method, params }));
    const response = await reply;
    if (response.error) throw new Error(response.error.message);
    return response.result;
  }
  async function run(expression) {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? expression);
    return response.result.value;
  }
  const wait = (expression) => retry(async () => assert.ok(await run(expression), expression));
  const click = (selector) => run("document.querySelector(" + JSON.stringify(selector) + ").click()");
  async function openHome() {
    await call("Page.navigate", { url: origin });
    await wait("document.querySelector('#month-grid .day') && !document.querySelector('#calendar-page').hidden");
  }
  async function addRole(title) {
    await click("#add-role");
    await run(`Object.assign(document.querySelector('[name=company_name]'), {value:'Northstar'});
      Object.assign(document.querySelector('[name=company_type]'), {value:'University'});
      Object.assign(document.querySelector('[name=role_title]'), {value:${JSON.stringify(title)}});`);
    await click("#save-role");
    await wait("!document.querySelector('#role-dialog').open && document.querySelector('#draft-roles').textContent.includes(" + JSON.stringify(title) + ")");
  }

  await call("Network.enable");
  await openHome();
  await click("#show-board");
  await addRole("Analyst");
  await addRole("Researcher");
  await click("#draft-roles article:first-child .actions button:first-child");
  await wait("document.querySelector('#role-dialog').open");
  assert.equal(await run("document.querySelector('#save-role').hidden"), true);
  await run("const companyField = document.querySelector('[name=company_type]'); companyField.value = 'Corporate'; companyField.dispatchEvent(new Event('input', { bubbles: true }))");
  await wait("document.querySelector('#role-saved').textContent === 'Saved' && !document.querySelector('#save-role').disabled");
  assert.equal((await (await fetch(origin + "/api/roles")).json())[0].company_type, "Corporate");
  await run("document.querySelector('[name=role_title]').value = 'Research Analyst'");
  await click("#close-role");
  await wait("!document.querySelector('#role-dialog').open && document.querySelector('#draft-roles').textContent.includes('Research Analyst')");

  await writeFile(original, "exact CV bytes");
  await click("#draft-roles article:first-child .actions button:first-child");
  await wait("document.querySelector('#role-dialog').open && document.querySelector('#attachments input')");
  const { root } = await call("DOM.getDocument");
  const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "#attachments input" });
  await call("DOM.setFileInputFiles", { nodeId, files: [original] });
  await wait("document.querySelector('#attachments a').textContent.includes('Sample CV.txt')");
  const downloadPath = await run("document.querySelector('#attachments a').getAttribute('href')");
  await rename(original, join(folder, "moved.txt"));
  assert.equal(await (await fetch(origin + downloadPath)).text(), "exact CV bytes");
  await writeFile(original, "replacement bytes");
  await run("window.confirm = () => { window.replacementPrompt = true; return false; }");
  await call("DOM.setFileInputFiles", { nodeId, files: [original] });
  assert.equal(await run("window.replacementPrompt === true"), true, "Replacing a saved file must prompt");
  assert.equal(await (await fetch(origin + downloadPath)).text(), "exact CV bytes");
  await click("#close-role");

  await click("#draft-roles article:first-child .actions button:nth-child(2)");
  await click("#cancel-submit");
  await wait("document.querySelectorAll('#draft-roles article').length === 2");
  await click("#draft-roles article:first-child .actions button:nth-child(2)");
  await click("#choose-today");
  const today = await run("document.querySelector('#application-date').value");
  await run(`window.realFetch = window.fetch; window.fetch = (...args) => args[0].endsWith('/submit')
    ? new Promise(resolve => { window.releaseSubmission = () => resolve(window.realFetch(...args)); })
    : window.realFetch(...args);`);
  await click("#confirm-submit");
  assert.equal(await run("document.querySelector('#cancel-submit').disabled"), true, "Cancel must be disabled during submission");
  await run("window.releaseSubmission(); window.fetch = window.realFetch");
  await wait("document.querySelectorAll('#submitted-roles article').length === 1");
  await click("#draft-roles article:first-child .actions button:nth-child(2)");
  await run("document.querySelector('#application-date').value = " + JSON.stringify(today));
  await click("#confirm-submit");
  await wait("document.querySelectorAll('#submitted-roles article').length === 2");
  await run("document.querySelector('#role-search').value = 'research'; document.querySelector('#role-search').dispatchEvent(new Event('input'))");
  await wait("document.querySelectorAll('#submitted-roles article').length === 1");
  await wait("document.querySelector('#submitted-roles').textContent.includes('0 days since submission')");
  await click("#show-results");
  await wait("document.querySelectorAll('#result-list article').length === 2");
  await click("#result-list article:first-child .actions button:last-child");
  await run(`document.querySelector('[name=kind]').value = 'interview';
    document.querySelector('[name=kind]').dispatchEvent(new Event('change'));
    document.querySelector('[name=received_on]').value = ${JSON.stringify(today)};
    document.querySelector('[name=interview_on]').value = ${JSON.stringify(today)};
    document.querySelector('[name=final_result]').value = 'Offer';`);
  await click("#save-result");
  await wait("document.querySelector('#result-list').textContent.includes('Offer')");
  assert.ok(await run("document.querySelector('#result-list').textContent.includes('Response after 0 days')"));
  for (const [filter, expected, count] of [
    [["awaiting"], "Awaiting response", 1],
    [["rejection"], "No applications match the selected statuses.", 0],
    [["interview"], "Offer", 1],
    [["awaiting", "interview"], "Offer", 2],
    [[], "Offer", 2],
  ]) {
    await run(`(() => {
      const selected = ${JSON.stringify(filter)};
      for (const checkbox of document.querySelectorAll('#result-filter input')) {
        if (checkbox.checked !== selected.includes(checkbox.value)) checkbox.click();
      }
    })()`);
    assert.equal(await run("document.querySelectorAll('#result-list article').length"), count);
    assert.ok(await run("document.querySelector('#result-list').textContent.includes(" + JSON.stringify(expected) + ")"));
  }
  await click("#save-data");
  await wait("document.querySelector('#save-status').textContent === 'Saved'");
  await click("#show-calendar");
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 2");
  await click("#previous-month");
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 0");
  await click("#next-month");
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 2");
  await click("#month-grid .calendar-entry");
  await wait("document.querySelector('#role-dialog').open");
  await click("#close-role");

  await stop(server);
  port = await startServer(port);
  await openHome();
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 2");
  await click("#show-results");
  await wait("document.querySelector('#result-list').textContent.includes('Offer')");
  assert.equal(await (await fetch(origin + downloadPath)).text(), "exact CV bytes");
  await click("#show-board");
  await wait("document.querySelectorAll('#submitted-roles .actions .danger').length === 2");
  assert.equal(await run(`(() => {
    const actions = document.querySelector('#submitted-roles .actions');
    return actions.firstElementChild.getBoundingClientRect().top ===
      actions.lastElementChild.getBoundingClientRect().top;
  })()`), true);
  await run("window.confirm = () => false");
  await click("#submitted-roles .danger");
  assert.equal(await run("document.querySelectorAll('#submitted-roles article').length"), 2);
  await run("window.confirm = () => true");
  await click("#submitted-roles .danger");
  await wait("document.querySelectorAll('#submitted-roles article').length === 1");
  await click("#show-calendar");
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 1");
  await click(`#month-grid .calendar-date[data-date="${today}"]`);
  await wait("document.querySelector('#role-dialog').open");
  assert.equal(await run("document.querySelector('#role-status').textContent"), "Applied " + today);
  await run(`document.querySelector('[name=company_name]').value = 'Calendar Company';
    document.querySelector('[name=company_type]').value = 'Corporate';
    document.querySelector('[name=role_title]').value = 'Calendar Role';`);
  await click("#save-role");
  await wait("document.querySelectorAll('#month-grid .calendar-entry').length === 2");
  const calendarRole = (await (await fetch(origin + "/api/roles")).json()).find((role) => role.role_title === "Calendar Role");
  assert.equal(calendarRole.submitted_on, today);
  assert.deepEqual(outsideRequests, []);
  console.log("Browser smoke passed, including upload and server process restart.");
} finally {
  socket?.close();
  await stop(browser);
  await stop(server);
  await rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
