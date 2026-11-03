// =============================================================================
// app.js — Todo App Frontend
// =============================================================================
//
// This file is the entire "brain" of the frontend. It is responsible for:
//   1. Talking to the Flask REST API (fetching, creating, toggling, deleting)
//   2. Keeping the local state (the `todos` array) in sync with the server
//   3. Re-rendering the page whenever state changes
//
// Reading order: Config → State → DOM refs → API layer → Render → Events → Init
// =============================================================================


// =============================================================================
// CONFIG
// =============================================================================
// The base URL of our Flask API. Every network request in this file is built
// by appending a path to this string (e.g. API_BASE + '/todos').
//
// If you deploy the backend to a different host or port, change only this line.
// =============================================================================
const API_BASE = 'http://127.0.0.1:5000/api';


// =============================================================================
// STATE
// =============================================================================
// We keep two pieces of state in memory:
//
//   todos  — the authoritative list of todo objects received from the server.
//            Each object looks like:
//              { id: 1, title: "Buy milk", completed: false, created_at: "…" }
//            We never mutate individual todo objects; we replace them wholesale
//            when the server returns an updated copy.
//
//   filter — which subset of todos to show in the list. The render() function
//            reads this value to decide what is visible without making an extra
//            network round-trip.
// =============================================================================
let todos = [];       // full list fetched from server
let filter = 'all';   // 'all' | 'active' | 'completed'


// =============================================================================
// DOM REFS
// =============================================================================
// We grab references to the HTML elements we need once, at startup, rather than
// calling document.getElementById() inside every function. This is faster and
// keeps the rest of the code clean.
// =============================================================================
const addForm        = document.getElementById('add-form');
const todoInput      = document.getElementById('todo-input');
const todoList       = document.getElementById('todo-list');
const emptyState     = document.getElementById('empty-state');
const statusBanner   = document.getElementById('status-banner');
const listFooter     = document.getElementById('list-footer');
const remainingCount = document.getElementById('remaining-count');
const clearCompleted = document.getElementById('clear-completed');
const filterBtns     = document.querySelectorAll('.filter-btn');


// =============================================================================
// API LAYER
// =============================================================================
// All network communication is funnelled through two things:
//
//   apiFetch()  — a thin wrapper around the browser's built-in fetch() API
//   api         — a plain object whose methods call apiFetch with the right
//                 HTTP method and URL for each operation
//
// WHY async/await?
// ─────────────────
// Network requests take time — the browser sends a request and then has to wait
// for the server to respond. JavaScript is single-threaded, so if we blocked
// while waiting, the entire page would freeze.
//
// async/await solves this elegantly:
//   • Marking a function `async` means it always returns a Promise.
//   • Writing `await somePromise` inside an async function *pauses that
//     function* until the Promise resolves, but crucially it does NOT block
//     the rest of the browser — other events (clicks, rendering) can still run.
//   • When the Promise resolves, execution resumes right where we left off,
//     as if the code had been synchronous all along.
//
// The alternative — callback hell or raw .then()/.catch() chains — produces
// code that is much harder to read and reason about.
// =============================================================================

/**
 * apiFetch — the single gateway for all API calls.
 *
 * @param {string} path     - API path, e.g. '/todos' or '/todos/3'
 * @param {object} options  - Standard fetch() options (method, body, etc.)
 * @returns {Promise<object|null>} Parsed JSON body, or null for 204 No Content
 *
 * HOW IT WORKS — step by step:
 *
 *  1. We merge a default Content-Type header with any caller-supplied headers.
 *     Telling the server we're sending JSON is required for Flask to parse our
 *     request bodies correctly (request.get_json() on the server side).
 *
 *  2. We call the browser's fetch() with the full URL and options.
 *     `await` pauses here until the HTTP response headers arrive.
 *
 *  3. HTTP 204 ("No Content") is what our DELETE endpoint returns — there is
 *     no body to parse, so we return null immediately.
 *
 *  4. For all other responses we `await res.json()`, which parses the response
 *     body as JSON. This is itself asynchronous because the browser may still
 *     be streaming the body bytes when the headers arrive.
 *
 *  5. If the HTTP status code indicates an error (4xx, 5xx), `res.ok` is false.
 *     We throw an Error using the server's own error message if present, or a
 *     generic "HTTP 4xx" fallback. Throwing inside an async function rejects
 *     the returned Promise, which callers catch with try/catch.
 *
 *  6. On success we return the parsed data object to the caller.
 */
async function apiFetch(path, options = {}) {
  // Step 1: always send Content-Type so Flask knows we're speaking JSON
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  // Step 2: make the HTTP request; pause until the response headers arrive
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Step 3: DELETE returns 204 No Content — nothing to parse
  if (res.status === 204) return null;

  // Step 4: parse the JSON body (awaits the rest of the response stream)
  const data = await res.json();

  // Step 5: if the server signalled an error, surface it as a JS exception
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  // Step 6: hand the parsed object back to the caller
  return data;
}

/**
 * api — a thin, named interface over apiFetch.
 *
 * Having named methods (getAll, create, toggle, destroy) instead of raw fetch
 * calls scattered through the event handlers keeps each operation in one place.
 * If the URL structure ever changes, we update it here once.
 *
 * Each method returns the Promise that apiFetch returns, so callers can
 * `await` them directly.
 *
 *   getAll()        GET  /api/todos          → array of todo objects
 *   create(title)   POST /api/todos          → the newly created todo object
 *   toggle(id)      PATCH /api/todos/:id     → the updated todo object
 *   destroy(id)     DELETE /api/todos/:id    → null (204 No Content)
 */
const api = {
  getAll:  ()      => apiFetch('/todos'),
  create:  (title) => apiFetch('/todos',       { method: 'POST',   body: JSON.stringify({ title }) }),
  toggle:  (id)    => apiFetch(`/todos/${id}`, { method: 'PATCH' }),
  destroy: (id)    => apiFetch(`/todos/${id}`, { method: 'DELETE' }),
};


// =============================================================================
// RENDER LAYER
// =============================================================================
// These functions are the only place that touches the DOM to display todos.
// Keeping rendering separate from event handling means we can call render()
// from anywhere after state changes and always get a consistent UI.
// =============================================================================

/**
 * visibleTodos — returns the subset of todos that the current filter shows.
 *
 * We store the *complete* list in `todos` and compute the visible slice here,
 * rather than making a new API call each time the user clicks a filter button.
 * This makes filtering instant with no server round-trip.
 */
function visibleTodos() {
  if (filter === 'active')    return todos.filter(t => !t.completed);
  if (filter === 'completed') return todos.filter(t =>  t.completed);
  return todos; // 'all' — no filtering needed
}

/**
 * render — rebuilds the entire visible todo list and updates all UI counters.
 *
 * We clear todoList.innerHTML and rebuild from scratch on every call. This is
 * simple and correct. For large lists a virtual DOM (like React) would be more
 * efficient, but for a personal todo app the simplicity is worth it.
 *
 * Steps:
 *  1. Get the filtered list of todos to display.
 *  2. Build one <li> per todo and append to the <ul>.
 *  3. Update the footer counts and show/hide the empty-state message.
 */
function render() {
  const visible = visibleTodos();

  // Step 1: wipe the current list so we can rebuild it cleanly
  todoList.innerHTML = '';

  // Step 2: create a <li> for every visible todo
  visible.forEach(todo => {
    const li = document.createElement('li');

    // The 'completed' CSS class crosses out the title via styles.css
    li.className = `todo-item${todo.completed ? ' completed' : ''}`;

    // Store the server's ID on the element — event handlers read this back
    // when a button is clicked to know which todo to act on
    li.dataset.id = todo.id;

    // data-action attributes on buttons are read by the delegated click handler
    // below. Using data attributes avoids creating a new closure per todo.
    li.innerHTML = `
      <span class="todo-title">${escapeHtml(todo.title)}</span>
      <div class="todo-actions">
        <button
          class="btn-icon complete"
          title="${todo.completed ? 'Mark as active' : 'Mark as complete'}"
          aria-label="${todo.completed ? 'Mark as active' : 'Mark as complete'}"
          data-action="toggle"
        >${todo.completed ? '↩' : '✓'}</button>
        <button
          class="btn-icon delete"
          title="Delete todo"
          aria-label="Delete todo"
          data-action="delete"
        >✕</button>
      </div>
    `;

    todoList.appendChild(li);
  });

  // Step 3: update footer counts
  const activeCount  = todos.filter(t => !t.completed).length;
  const hasCompleted = todos.some(t => t.completed);

  emptyState.hidden      = visible.length > 0;   // show only when list is empty
  listFooter.hidden      = todos.length === 0;   // hide footer if no todos at all
  remainingCount.textContent = `${activeCount} item${activeCount !== 1 ? 's' : ''} left`;
  clearCompleted.hidden  = !hasCompleted;        // hide button if nothing to clear
}

/**
 * escapeHtml — sanitises a string before inserting it into the DOM as HTML.
 *
 * WHY THIS MATTERS (XSS prevention):
 * If a user saves a todo with the title  <script>alert('hacked')</script>
 * and we inject that string directly into innerHTML, the browser would execute
 * it as a real script tag — a classic Cross-Site Scripting (XSS) attack.
 *
 * By replacing the five special HTML characters with their safe entity
 * equivalents, the string is rendered as visible text, never as markup.
 *
 *   &  →  &amp;   (must be first to avoid double-encoding other replacements)
 *   <  →  &lt;
 *   >  →  &gt;
 *   "  →  &quot;
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// =============================================================================
// BANNER (user feedback)
// =============================================================================

// We hold a reference to the auto-hide timer so we can cancel it if showBanner
// is called again before the previous banner has disappeared.
let bannerTimer = null;

/**
 * showBanner — displays a dismissing notification at the top of the list.
 *
 * @param {string} message  - Human-readable message to display
 * @param {string} type     - 'error' (default, red) or 'info' (blue)
 *
 * The banner automatically hides itself after 4 seconds using setTimeout.
 * If showBanner is called while a banner is already visible, clearTimeout
 * cancels the old timer and starts a fresh 4-second countdown.
 */
function showBanner(message, type = 'error') {
  statusBanner.textContent = message;
  statusBanner.className   = `status-banner${type === 'info' ? ' info' : ''}`;
  statusBanner.hidden      = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { statusBanner.hidden = true; }, 4000);
}


// =============================================================================
// EVENT HANDLERS
// =============================================================================
// Each handler follows the same pattern:
//   1. Read what the user did (form value, button clicked, etc.)
//   2. Call the appropriate api.* method and await the result
//   3. Update the local `todos` state with the server's response
//   4. Call render() to reflect the new state in the DOM
//   5. In the catch block, show an error banner — never let an unhandled
//      rejection silently swallow a failure
// =============================================================================

/**
 * "Add todo" form submission.
 *
 * e.preventDefault() stops the browser from doing its default form behaviour
 * (a full page reload), letting us handle everything in JavaScript instead.
 *
 * We use unshift() to add the new todo to the *front* of the array so it
 * appears at the top of the list, matching the server's ORDER BY created_at DESC.
 */
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();                         // prevent page reload
  const title = todoInput.value.trim();
  if (!title) return;                         // ignore empty submissions

  try {
    const newTodo = await api.create(title);  // POST to /api/todos
    todos.unshift(newTodo);                   // prepend to local state
    todoInput.value = '';                     // clear the input field
    render();
  } catch (err) {
    showBanner(`Could not add todo: ${err.message}`);
  }
});

/**
 * Delegated click handler for ✓ (toggle) and ✕ (delete) buttons.
 *
 * WHY DELEGATION?
 * ────────────────
 * We re-create the <li> elements on every render() call, so attaching a
 * listener directly to each button would mean re-attaching on every render.
 * Instead, we attach ONE listener to the parent <ul> and let click events
 * "bubble up" to it. We then inspect e.target to find out which button
 * was actually clicked.
 *
 * btn.closest('[data-action]') walks up the DOM tree from the clicked element
 * until it finds an ancestor (or itself) with a data-action attribute.
 * If the user clicked somewhere else in the list (e.g. the title text),
 * closest() returns null and we bail out early.
 *
 * OPTIMISTIC DISABLE:
 * We disable the clicked button immediately (before the await) to prevent
 * the user from clicking it a second time while the request is in flight.
 * If the request fails, we re-enable it so they can try again.
 */
todoList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;                           // click was not on an action button

  const li     = btn.closest('.todo-item');
  const id     = Number(li.dataset.id);       // recover the todo's server ID
  const action = btn.dataset.action;          // 'toggle' or 'delete'

  btn.disabled = true;                        // prevent double-click while awaiting

  try {
    if (action === 'toggle') {
      // PATCH /api/todos/:id — server flips the completed flag and returns the
      // updated todo. We replace the old entry in the array with the new one.
      const updated = await api.toggle(id);
      const idx = todos.findIndex(t => t.id === id);
      if (idx !== -1) todos[idx] = updated;

    } else if (action === 'delete') {
      // DELETE /api/todos/:id — server returns 204, apiFetch returns null.
      // We remove the todo from the local array by filtering it out.
      await api.destroy(id);
      todos = todos.filter(t => t.id !== id);
    }
    render(); // button re-enabled implicitly because render() rebuilds the DOM
  } catch (err) {
    showBanner(`Action failed: ${err.message}`);
    btn.disabled = false;                     // let the user retry on failure
  }
});

/**
 * Filter buttons (All / Active / Completed).
 *
 * Clicking a filter button only changes the local `filter` variable and
 * re-renders. No network request is needed because we already have all todos
 * in memory — filtering is purely a client-side operation.
 */
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    // Toggle the 'active' highlight class: on the clicked button, off all others
    filterBtns.forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

/**
 * "Clear completed" button.
 *
 * WHY Promise.all?
 * ─────────────────
 * We may need to delete several todos at once. We could delete them one at a
 * time in a loop, but that would be slow: each delete would have to wait for
 * the previous one to finish (sequential).
 *
 * Promise.all(arrayOfPromises) fires all the requests simultaneously (parallel)
 * and returns a single Promise that resolves only when every individual Promise
 * has resolved. This is much faster.
 *
 * If any single delete fails, Promise.all rejects immediately. In that case we
 * re-fetch the whole list from the server (loadTodos) to make sure the UI
 * accurately reflects whatever partial state the server is in.
 */
clearCompleted.addEventListener('click', async () => {
  const completed = todos.filter(t => t.completed);
  try {
    // Fire all DELETE requests in parallel, wait for all to succeed
    await Promise.all(completed.map(t => api.destroy(t.id)));
    todos = todos.filter(t => !t.completed); // remove all completed from local state
    render();
  } catch (err) {
    showBanner(`Could not clear completed todos: ${err.message}`);
    // One or more deletes may have succeeded — re-sync with the server
    // to avoid showing todos that were actually deleted
    await loadTodos();
  }
});


// =============================================================================
// INIT
// =============================================================================

/**
 * loadTodos — fetches the full todo list from the server and renders it.
 *
 * Called once on page load, and again after a "clear completed" failure to
 * re-sync the UI with the server's actual state.
 *
 * HOW ERROR HANDLING WORKS HERE:
 * ────────────────────────────────
 * Network requests can fail for many reasons: the server isn't running, the
 * user is offline, a firewall blocked the request, etc. Without a try/catch,
 * a failed `await` would throw an unhandled Promise rejection — the error
 * would disappear silently into the console and the user would see a blank list
 * with no explanation.
 *
 * By wrapping the await in try/catch we intercept the error and show a human-
 * readable message via showBanner(). The user knows something went wrong and
 * can take action (e.g. start the server).
 */
async function loadTodos() {
  try {
    todos = await api.getAll(); // GET /api/todos — returns array of todo objects
    render();
  } catch (err) {
    showBanner('Could not load todos — is the server running?');
  }
}

// Kick everything off as soon as the script is parsed
loadTodos();
