# Todo App — Implementation Plan

## Brand: TD SYNNEX Color Palette

| Role | Name | Hex |
|---|---|---|
| Primary | Deep Blue | `#003DA5` |
| Secondary | Bright Blue | `#0066CC` |
| Accent | Orange | `#FF9900` |
| Text | Black | `#000000` |
| Subtle text / borders | Gray | `#666666` |
| Background | White | `#FFFFFF` |


## Overview

Build a simple todo application inside `lab1/todo-app/`. The backend is a Python Flask REST API backed by SQLite via SQLAlchemy. The frontend is plain HTML/CSS/JavaScript, served as static files directly by Flask. Features: create, list, mark complete, and delete todos. No authentication, no framework, no external services.

---

## Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Python Flask | Lightweight, minimal setup |
| ORM | Flask-SQLAlchemy | Integrates cleanly with Flask and SQLite |
| Database | SQLite | File-based, zero config |
| Frontend | Vanilla JS + HTML/CSS | No build step, served by Flask |

---

## Project Directory Structure

```
lab1/todo-app/
├── app/
│   ├── __init__.py        # Flask app factory
│   ├── models.py          # SQLAlchemy Todo model
│   ├── routes.py          # REST API blueprints
│   ├── static/
│   │   ├── style.css
│   │   └── app.js
│   └── templates/
│       └── index.html
├── instance/
│   └── todos.db           # SQLite DB (auto-created)
├── requirements.txt
└── run.py                 # Entry point
```

---

## Database Schema

### Table: `todo`

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PRIMARY KEY, AUTOINCREMENT |
| title | VARCHAR(200) | NOT NULL |
| completed | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | DATETIME | NOT NULL, DEFAULT now() |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/todos` | Return all todos, ordered by created_at desc |
| POST | `/api/todos` | Create a new todo (body: `{ "title": "..." }`) |
| PATCH | `/api/todos/<id>` | Toggle completed on a single todo |
| DELETE | `/api/todos/<id>` | Delete a single todo |
| GET | `/` | Serve the frontend HTML |

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold

**Status:** `[ ] pending`

**Intent:** Create the directory structure, `requirements.txt`, and the Flask app factory so the project is runnable before any feature code is added.

**Expected Outcomes:**
- `lab1/todo-app/` exists with all directories in place
- `requirements.txt` lists `flask` and `flask-sqlalchemy`
- `run.py` starts a Flask dev server without errors
- `app/__init__.py` creates and configures the Flask app and database

**Todo List:**
1. Create directory tree: `todo-app/app/static/`, `todo-app/app/templates/`, `todo-app/instance/`
2. Write `requirements.txt` with `flask` and `flask-sqlalchemy`
3. Write `app/__init__.py` — app factory, SQLite URI pointing to `instance/todos.db`, SQLAlchemy init
4. Write `run.py` — imports app factory, calls `app.run(debug=True)`

**Relevant Context:** Flask app factory pattern — `create_app()` in `__init__.py`, `db = SQLAlchemy()` initialised there.

---

### Sub-Task 2 — Database Model

**Status:** `[ ] pending`

**Intent:** Define the `Todo` SQLAlchemy model and wire it into the app so the schema is created on first run.

**Expected Outcomes:**
- `app/models.py` contains the `Todo` model matching the schema above
- Running `run.py` auto-creates `instance/todos.db` with the `todo` table

**Todo List:**
1. Write `app/models.py` — `Todo` class with `id`, `title`, `completed`, `created_at`
2. Import `models` inside `app/__init__.py` and call `db.create_all()` within app context

**Relevant Context:** `app/__init__.py` from Sub-Task 1.

---

### Sub-Task 3 — REST API Routes

**Status:** `[ ] pending`

**Intent:** Implement the four JSON API endpoints in a Flask Blueprint.

**Expected Outcomes:**
- `GET /api/todos` returns a JSON array of all todos
- `POST /api/todos` creates a new todo and returns it as JSON (201)
- `PATCH /api/todos/<id>` toggles `completed` and returns the updated todo
- `DELETE /api/todos/<id>` removes the todo and returns 204

**Todo List:**
1. Write `app/routes.py` — Flask Blueprint `api`, register all four routes
2. Each route serialises the `Todo` model to a dict (id, title, completed, created_at)
3. Register the blueprint in `app/__init__.py` with url prefix `/api`

**Relevant Context:** `app/models.py` from Sub-Task 2; `app/__init__.py` blueprint registration.

---

### Sub-Task 4 — Frontend

**Status:** `[ ] pending`

**Intent:** Build the single-page HTML/CSS/JS UI that calls the API and renders todos without a page reload.

**Expected Outcomes:**
- `GET /` serves `templates/index.html`
- Page loads existing todos on open
- User can type a title and submit to create a todo
- Each todo row has a checkbox (toggle complete) and a delete button
- Completed todos are visually distinct (e.g. strikethrough)

**Todo List:**
1. Add a root route `GET /` in `routes.py` that renders `index.html`
2. Write `app/templates/index.html` — input form, todo list container, link to `style.css` and `app.js`
3. Write `app/static/style.css` — TD SYNNEX branded styles:
   - Page background: white (`#FFFFFF`), body text: black (`#000000`)
   - Header/navbar background: Deep Blue (`#003DA5`), header text: white
   - Primary button (Add): Deep Blue (`#003DA5`) background, white text; hover state uses Bright Blue (`#0066CC`)
   - Delete button: Orange (`#FF9900`) background, black text
   - Todo item border/divider: Gray (`#666666`) at low opacity
   - Completed todo text: Gray (`#666666`) with strikethrough
   - Checkbox accent color: Deep Blue (`#003DA5`)
4. Write `app/static/app.js` — `fetch`-based functions: `loadTodos()`, `createTodo()`, `toggleTodo(id)`, `deleteTodo(id)`; render function builds DOM from API responses

**Relevant Context:** API shape from Sub-Task 3; Flask `url_for('static', filename=...)` for asset paths.

---

## Implementation Notes

- The frontend communicates with the backend via `fetch()` calls to `/api/todos` — no CORS issues since both are served from the same Flask origin.
- `instance/` should be added to `.gitignore` to avoid committing the SQLite file.
- No authentication, no pagination, no filtering — out of scope.
