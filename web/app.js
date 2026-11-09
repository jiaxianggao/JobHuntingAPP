import { calendarDate, localDateKey, monthCells } from "./dates.js";

const get = (id) => document.getElementById(id);
const dialog = get("role-dialog");
const form = get("role-form");
let roles = [];
let selectedId = null;
let calendarSubmissionDate = null;
let month = new Date();
let submittingId = null;
const submitDialog = get("submit-dialog");
const dateInput = get("application-date");
const resultDialog = get("result-dialog");
const resultForm = get("result-form");
let resultRoleId = null;
let roleAutosave;
let savedRoleValues;
const uploads = new Set();
let uploadError;
let displayedDate = localDateKey(new Date());

for (const [modal, action] of [[dialog, "save-role"], [submitDialog, "confirm-submit"], [resultDialog, "save-result"]]) {
  modal.addEventListener("cancel", (event) => {
    if (get(action).disabled) event.preventDefault();
  });
}

async function api(path, options) {
  const response = await fetch("/api" + path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showError(id, error) {
  const message = get(id);
  message.textContent = error?.message ?? "";
  message.hidden = !error;
}

function button(label, action) {
  const control = document.createElement("button");
  control.type = "button";
  control.textContent = label;
  control.addEventListener("click", action);
  return control;
}

function render() {
  renderBoard();
  renderCalendar();
  renderResults();
}

function elapsed(role) {
  const days = role.days_since_submission;
  return days + (days === 1 ? " day" : " days") + " since submission";
}

function renderBoard() {
  get("draft-roles").replaceChildren();
  get("submitted-roles").replaceChildren();
  const query = get("role-search").value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const role of roles) {
    if (query && ![role.role_title, role.company_name].some((value) => value.toLocaleLowerCase().includes(query))) continue;
    matches++;
    const card = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = role.role_title;
    const company = document.createElement("p");
    company.textContent = role.company_name + " · " + role.company_type;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(button("Open application", () => openRole(role.id)));
    if (role.submitted_on) {
      const date = document.createElement("p");
      date.textContent = "Applied " + role.submitted_on + " · " + elapsed(role);
      card.append(title, company, date, actions);
    } else {
      actions.append(button("Mark submitted", () => openSubmission(role)));
      card.append(title, company, actions);
    }
    const remove = button("Delete", () => deleteRole(role, remove));
    remove.className = "danger";
    remove.setAttribute("aria-label", "Delete " + role.role_title + " at " + role.company_name);
    actions.append(remove);
    get(role.submitted_on ? "submitted-roles" : "draft-roles").append(card);
  }
  get("search-empty").hidden = !query || matches > 0;
}

get("role-search").addEventListener("input", renderBoard);

async function deleteRole(role, control) {
  if (!window.confirm(`Delete "${role.role_title}" at ${role.company_name}? This also deletes its saved documents and result.`)) return;
  control.disabled = true;
  try {
    await api("/roles/" + role.id, { method: "DELETE" });
    roles = roles.filter((item) => item.id !== role.id);
    render();
    await refresh();
  } catch (error) {
    showError("page-error", error);
  } finally {
    control.disabled = false;
  }
}

const resultLabels = {
  awaiting: "Awaiting response",
  no_response: "No response after 4 weeks",
  rejection: "Rejection",
  interview: "Interview",
};

function renderResults() {
  const list = get("result-list");
  const filters = new Set([...get("result-filter").querySelectorAll("input:checked")].map((input) => input.value));
  list.replaceChildren();
  for (const role of roles.filter((item) => item.submitted_on && (!filters.size || filters.has(item.result_status)))) {
    const card = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = role.role_title + " · " + role.company_name;
    card.append(title);
    const status = document.createElement("span");
    status.className = "result-status";
    status.dataset.status = role.result_status;
    status.textContent = resultLabels[role.result_status];
    const summary = document.createElement("p");
    const responseDays = role.days_to_response;
    const timing = responseDays === null ? elapsed(role)
      : "Response after " + responseDays + (responseDays === 1 ? " day" : " days");
    summary.append(status, " · " + timing);
    card.append(summary);
    const result = role.result;
    const details = [
      result && "Received " + result.received_on,
      result?.interview_on && "Interview on " + result.interview_on,
      result?.final_result && "Final result: " + result.final_result,
    ];
    for (const detail of details.filter(Boolean)) {
      const line = document.createElement("p");
      line.textContent = detail;
      card.append(line);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(button("Open application", () => openRole(role.id)),
      button(result ? "Edit result" : "Record result", () => openResult(role)));
    card.append(actions);
    list.append(card);
  }
  if (!list.childElementCount) {
    list.textContent = filters.size ? "No applications match the selected statuses." : "Submitted applications will appear here.";
  }
}

get("result-filter").addEventListener("change", renderResults);

function updateResultFields() {
  const interview = resultForm.elements.kind.value === "interview";
  get("interview-fields").hidden = !interview;
  resultForm.elements.interview_on.required = interview;
}

function openResult(role) {
  resultRoleId = role.id;
  get("result-heading").textContent = role.role_title + " result";
  resultForm.reset();
  for (const field of ["kind", "received_on", "interview_on", "final_result"]) {
    resultForm.elements[field].value = role.result?.[field] ?? "";
  }
  resultForm.elements.received_on.min = role.submitted_on;
  resultForm.elements.received_on.max = localDateKey(new Date());
  updateResultFields();
  showError("result-error");
  resultDialog.showModal();
}

resultForm.elements.kind.addEventListener("change", updateResultFields);
get("close-result").addEventListener("click", () => resultDialog.close());
resultForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = get("save-result");
  if (save.disabled) return;
  const close = get("close-result");
  save.disabled = close.disabled = true;
  try {
    await api("/roles/" + resultRoleId + "/result", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(resultForm))),
    });
    get("save-status").textContent = "Saved";
    resultDialog.close();
    await refresh();
  } catch (error) {
    showError("result-error", error);
  } finally {
    save.disabled = close.disabled = false;
  }
});

function renderCalendar() {
  get("month-name").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = get("month-grid");
  grid.replaceChildren();
  for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const heading = document.createElement("div");
    heading.className = "weekday";
    heading.textContent = weekday;
    grid.append(heading);
  }
  const today = localDateKey(new Date());
  for (const date of monthCells(month)) {
    const cell = document.createElement("div");
    cell.className = "day";
    if (date) {
      const key = localDateKey(date);
      cell.classList.toggle("today", key === today);
      const label = document.createElement("time");
      label.dateTime = key;
      label.textContent = date.getDate();
      if (key <= today) {
        const add = button(String(date.getDate()), () => openRole(null, key));
        add.className = "calendar-date";
        add.dataset.date = key;
        add.setAttribute("aria-label", "Add application for " + date.toLocaleDateString(undefined, { dateStyle: "long" }));
        cell.append(add);
      } else {
        cell.append(label);
      }
      for (const role of roles.filter((item) => item.submitted_on === key)) {
        const entry = button(role.role_title + " · " + role.company_name, () => openRole(role.id));
        entry.className = "calendar-entry";
        cell.append(entry);
      }
    }
    grid.append(cell);
  }
}

function chooseToday() {
  dateInput.max = dateInput.value = localDateKey(new Date());
}

function openSubmission(role) {
  submittingId = role.id;
  get("submit-role-name").textContent = role.role_title + " · " + role.company_name;
  chooseToday();
  showError("submit-error");
  submitDialog.showModal();
}

get("submit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const confirm = get("confirm-submit");
  if (confirm.disabled) return;
  const cancel = get("cancel-submit");
  confirm.disabled = cancel.disabled = true;
  try {
    const role = await api("/roles/" + submittingId + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submitted_on: dateInput.value }),
    });
    const [year, monthNumber] = role.submitted_on.split("-").map(Number);
    month = calendarDate(year, monthNumber - 1);
    submitDialog.close();
    await refresh();
  } catch (error) {
    showError("submit-error", error);
    if (error.status === 409) await refresh();
  } finally {
    confirm.disabled = cancel.disabled = false;
  }
});

get("choose-today").addEventListener("click", chooseToday);
get("cancel-submit").addEventListener("click", () => submitDialog.close());
for (const [control, offset] of [["previous-month", -1], ["next-month", 1]]) {
  get(control).addEventListener("click", () => {
    month = calendarDate(month.getFullYear(), month.getMonth() + offset);
    renderCalendar();
  });
}

async function refresh() {
  try {
    roles = await api("/roles");
    displayedDate = localDateKey(new Date());
    render();
    showError("page-error");
    return true;
  } catch (error) {
    showError("page-error", error);
  }
}

async function openRole(id, submissionDate = null) {
  try {
    const role = id === null ? null : await api("/roles/" + id);
    selectedId = id;
    calendarSubmissionDate = submissionDate;
    get("save-role").hidden = id !== null;
    uploadError = null;
    form.reset();
    const companyType = form.elements.company_type;
    companyType.querySelector("[data-legacy]")?.remove();
    if (role && !["University", "Corporate"].includes(role.company_type)) {
      const legacy = new Option(role.company_type, role.company_type);
      legacy.dataset.legacy = "";
      companyType.append(legacy);
    }
    for (const field of ["company_name", "company_type", "role_title"]) {
      form.elements[field].value = role?.[field] ?? "";
    }
    get("role-heading").textContent = role?.role_title ?? "Add role";
    savedRoleValues = JSON.stringify(Object.fromEntries(new FormData(form)));
    get("role-saved").textContent = "";
    const applied = role?.submitted_on ?? submissionDate;
    get("role-status").textContent = applied
      ? "Applied " + applied + (role ? " · " + elapsed(role) : "") : "Not submitted";
    renderAttachments(role);
    showError("role-error");
    showError("page-error");
    dialog.showModal();
  } catch (error) {
    showError("page-error", error);
  }
}

function renderAttachments(role) {
  get("attachments").hidden = !role;
  showError("attachment-error");
  const list = get("document-list");
  list.replaceChildren();
  if (!role) return;
  for (const [kind, title] of [["cv", "CV"], ["cover_letter", "Cover letter"]]) {
    const path = "/roles/" + role.id + "/attachments/" + kind;
    const label = document.createElement("label");
    label.append(title);
    const file = document.createElement("input");
    file.type = "file";
    const saved = document.createElement("a");
    saved.href = "/api" + path;
    let savedFilename;
    function update(filename) {
      savedFilename = filename;
      saved.hidden = !filename;
      saved.textContent = filename ? "Open saved " + title + " · " + filename : "";
    }
    update(role.attachments[kind]);
    file.addEventListener("change", async () => {
      const upload = file.files[0];
      if (!upload) return;
      if (savedFilename && !window.confirm("Replace the saved " + title + " (" + savedFilename + ")?")) {
        file.value = "";
        return;
      }
      file.disabled = true;
      uploadError = null;
      get("save-status").textContent = "";
      showError("attachment-error");
      let pending;
      try {
        if (upload.size > 25 * 1024 ** 2) throw new Error("Choose a file no larger than 25 MiB.");
        pending = api(path + "?filename=" + encodeURIComponent(upload.name), { method: "PUT", body: upload });
        uploads.add(pending);
        const result = await pending;
        update(result.attachments[kind]);
      } catch (error) {
        uploadError = error;
        showError("attachment-error", error);
      } finally {
        uploads.delete(pending);
        file.value = "";
        file.disabled = false;
      }
    });
    label.append(file);
    list.append(label, saved);
  }
}

async function saveRole(closeAfter) {
  clearTimeout(roleAutosave);
  const save = get("save-role");
  if (save.disabled) return;
  const close = get("close-role");
  save.disabled = close.disabled = true;
  const fields = Object.fromEntries(new FormData(form));
  const values = JSON.stringify(fields);
  if (calendarSubmissionDate && selectedId === null) fields.submitted_on = calendarSubmissionDate;
  const controls = [...form.elements].filter((element) => element.name);
  controls.forEach((element) => { element.disabled = true; });
  try {
    const updated = await api(selectedId === null ? "/roles" : "/roles/" + selectedId, {
      method: selectedId === null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    savedRoleValues = values;
    get("role-heading").textContent = updated.role_title;
    if (closeAfter) await Promise.allSettled([...uploads]);
    get("role-saved").textContent = uploadError ? "" : "Saved";
    showError("role-error");
    if (closeAfter && !uploadError) {
      get("save-status").textContent = "Saved";
      dialog.close();
    }
    await refresh();
  } catch (error) {
    showError("role-error", error);
  } finally {
    controls.forEach((element) => { element.disabled = false; });
    save.disabled = close.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveRole(true);
});
form.addEventListener("input", () => {
  clearTimeout(roleAutosave);
  get("role-saved").textContent = "";
  get("save-status").textContent = "";
  if (selectedId === null) return;
  roleAutosave = setTimeout(() => {
    if (dialog.open && form.checkValidity() && savedRoleValues !== JSON.stringify(Object.fromEntries(new FormData(form)))) {
      saveRole(false);
    }
  }, 600);
});
dialog.addEventListener("close", () => clearTimeout(roleAutosave));

function closeRole() {
  const changed = savedRoleValues !== JSON.stringify(Object.fromEntries(new FormData(form)));
  if (selectedId !== null && changed && form.checkValidity()) {
    saveRole(true);
  } else {
    dialog.close();
  }
}

dialog.addEventListener("cancel", (event) => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  closeRole();
});

get("save-data").addEventListener("click", async () => {
  get("save-status").textContent = "Saving…";
  await Promise.allSettled([...uploads]);
  if (uploadError) {
    get("save-status").textContent = "A document could not be saved. Open the application and try uploading it again.";
    return;
  }
  get("save-status").textContent = await refresh() ? "Saved" : "Could not check the saved data.";
});

get("close-role").addEventListener("click", closeRole);
get("add-role").addEventListener("click", () => openRole(null));
for (const page of ["calendar", "board", "results"]) {
  get("show-" + page).addEventListener("click", () => {
    for (const name of ["calendar", "board", "results"]) {
      get(name + "-page").hidden = name !== page;
      get("show-" + name).setAttribute("aria-pressed", String(name === page));
    }
    refresh();
  });
}
setInterval(() => {
  if (localDateKey(new Date()) !== displayedDate) refresh();
}, 30_000);
refresh();
