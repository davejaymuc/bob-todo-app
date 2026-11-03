"""Unit tests for the Todo REST API."""

import pytest
from app import app as flask_app
from database import db as _db
from models import Todo


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture()
def app():
    """Configure Flask for testing with an in-memory SQLite database."""
    flask_app.config.update(
        TESTING=True,
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
    )
    with flask_app.app_context():
        _db.create_all()
        yield flask_app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def todo(app):
    """Insert a single Todo row and return it."""
    with app.app_context():
        t = Todo(title="Sample todo")
        _db.session.add(t)
        _db.session.commit()
        # Detach from session so callers can safely read plain attributes
        _db.session.refresh(t)
        return {"id": t.id, "title": t.title, "completed": t.completed}


# ── Helper ─────────────────────────────────────────────────────────────────────

def json_of(response):
    return response.get_json()


# ── GET /api/todos ─────────────────────────────────────────────────────────────

class TestGetTodos:
    def test_returns_empty_list_when_no_todos(self, client):
        r = client.get("/api/todos")
        assert r.status_code == 200
        assert json_of(r) == []

    def test_returns_all_todos(self, client, todo):
        r = client.get("/api/todos")
        assert r.status_code == 200
        data = json_of(r)
        assert len(data) == 1
        assert data[0]["id"] == todo["id"]
        assert data[0]["title"] == todo["title"]

    def test_response_shape(self, client, todo):
        data = json_of(client.get("/api/todos"))
        item = data[0]
        assert set(item.keys()) == {"id", "title", "completed", "created_at"}

    def test_todos_ordered_newest_first(self, client, app):
        with app.app_context():
            _db.session.add(Todo(title="First"))
            _db.session.add(Todo(title="Second"))
            _db.session.commit()
        data = json_of(client.get("/api/todos"))
        assert data[0]["title"] == "Second"
        assert data[1]["title"] == "First"

    def test_completed_defaults_to_false(self, client, todo):
        data = json_of(client.get("/api/todos"))
        assert data[0]["completed"] is False


# ── POST /api/todos ────────────────────────────────────────────────────────────

class TestCreateTodo:
    def test_creates_todo_and_returns_201(self, client):
        r = client.post("/api/todos", json={"title": "New task"})
        assert r.status_code == 201
        data = json_of(r)
        assert data["title"] == "New task"
        assert data["completed"] is False
        assert "id" in data
        assert "created_at" in data

    def test_created_todo_appears_in_list(self, client):
        client.post("/api/todos", json={"title": "Persist me"})
        data = json_of(client.get("/api/todos"))
        assert any(t["title"] == "Persist me" for t in data)

    def test_strips_whitespace_from_title(self, client):
        r = client.post("/api/todos", json={"title": "  Trimmed  "})
        assert r.status_code == 201
        assert json_of(r)["title"] == "Trimmed"

    def test_missing_title_returns_400(self, client):
        r = client.post("/api/todos", json={})
        assert r.status_code == 400
        assert "error" in json_of(r)

    def test_empty_title_returns_400(self, client):
        r = client.post("/api/todos", json={"title": ""})
        assert r.status_code == 400
        assert json_of(r)["error"] == "title is required"

    def test_whitespace_only_title_returns_400(self, client):
        r = client.post("/api/todos", json={"title": "   "})
        assert r.status_code == 400

    def test_no_json_body_returns_400(self, client):
        r = client.post("/api/todos", content_type="application/json", data="")
        assert r.status_code == 400

    def test_non_json_body_returns_400(self, client):
        r = client.post("/api/todos", data="title=oops",
                        content_type="application/x-www-form-urlencoded")
        assert r.status_code == 400


# ── PUT /api/todos/<id> ────────────────────────────────────────────────────────

class TestUpdateTodo:
    def test_update_title(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"title": "Updated"})
        assert r.status_code == 200
        assert json_of(r)["title"] == "Updated"

    def test_update_completed(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"completed": True})
        assert r.status_code == 200
        assert json_of(r)["completed"] is True

    def test_update_title_and_completed_together(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}",
                       json={"title": "Both fields", "completed": True})
        assert r.status_code == 200
        data = json_of(r)
        assert data["title"] == "Both fields"
        assert data["completed"] is True

    def test_empty_body_is_noop(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={})
        assert r.status_code == 200
        data = json_of(r)
        assert data["title"] == todo["title"]
        assert data["completed"] == todo["completed"]

    def test_empty_title_returns_400(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"title": ""})
        assert r.status_code == 400
        assert json_of(r)["error"] == "title must not be empty"

    def test_whitespace_title_returns_400(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"title": "  "})
        assert r.status_code == 400

    def test_non_boolean_completed_returns_400(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"completed": "yes"})
        assert r.status_code == 400
        assert json_of(r)["error"] == "completed must be a boolean"

    def test_integer_completed_returns_400(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"completed": 1})
        assert r.status_code == 400

    def test_unknown_id_returns_404(self, client):
        r = client.put("/api/todos/9999", json={"title": "Ghost"})
        assert r.status_code == 404
        assert json_of(r) == {"error": "not found"}

    def test_response_contains_all_fields(self, client, todo):
        r = client.put(f"/api/todos/{todo['id']}", json={"title": "Check shape"})
        assert set(json_of(r).keys()) == {"id", "title", "completed", "created_at"}


# ── PATCH /api/todos/<id> ──────────────────────────────────────────────────────

class TestToggleTodo:
    def test_toggles_false_to_true(self, client, todo):
        r = client.patch(f"/api/todos/{todo['id']}")
        assert r.status_code == 200
        assert json_of(r)["completed"] is True

    def test_toggles_true_to_false(self, client, todo):
        client.patch(f"/api/todos/{todo['id']}")  # → True
        r = client.patch(f"/api/todos/{todo['id']}")  # → False
        assert json_of(r)["completed"] is False

    def test_id_and_title_unchanged(self, client, todo):
        r = client.patch(f"/api/todos/{todo['id']}")
        data = json_of(r)
        assert data["id"] == todo["id"]
        assert data["title"] == todo["title"]

    def test_unknown_id_returns_404(self, client):
        r = client.patch("/api/todos/9999")
        assert r.status_code == 404
        assert json_of(r) == {"error": "not found"}


# ── DELETE /api/todos/<id> ─────────────────────────────────────────────────────

class TestDeleteTodo:
    def test_deletes_existing_todo(self, client, todo):
        r = client.delete(f"/api/todos/{todo['id']}")
        assert r.status_code == 204
        assert r.data == b""

    def test_deleted_todo_not_in_list(self, client, todo):
        client.delete(f"/api/todos/{todo['id']}")
        data = json_of(client.get("/api/todos"))
        assert not any(t["id"] == todo["id"] for t in data)

    def test_unknown_id_returns_404(self, client):
        r = client.delete("/api/todos/9999")
        assert r.status_code == 404
        assert json_of(r) == {"error": "not found"}

    def test_double_delete_returns_404(self, client, todo):
        client.delete(f"/api/todos/{todo['id']}")
        r = client.delete(f"/api/todos/{todo['id']}")
        assert r.status_code == 404


# ── Error handlers ─────────────────────────────────────────────────────────────

class TestErrorHandlers:
    def test_unknown_route_returns_404_json(self, client):
        r = client.get("/api/nonexistent")
        assert r.status_code == 404
        assert json_of(r) == {"error": "not found"}

    def test_wrong_method_returns_405_json(self, client):
        r = client.post("/api/todos/1")
        assert r.status_code == 405
        assert json_of(r) == {"error": "method not allowed"}

    def test_500_handler_returns_json(self, client, app, monkeypatch):
        """Simulate an unhandled exception inside a route."""
        from app import get_todos

        def boom():
            raise RuntimeError("simulated failure")

        monkeypatch.setattr("app.get_todos", boom)
        # Trigger via a fresh route that raises
        with app.test_request_context():
            from flask import current_app
            with app.test_client() as c:
                # Patch the view function directly on the URL map
                app.view_functions["get_todos"] = boom
                # Flask propagates exceptions in TESTING mode; disable for this check
                app.config["TESTING"] = False
                r = c.get("/api/todos")
                app.config["TESTING"] = True
                app.view_functions["get_todos"] = get_todos  # restore
        assert r.status_code == 500
        assert json_of(r) == {"error": "internal server error"}


# ── Model: to_dict ─────────────────────────────────────────────────────────────

class TestTodoModel:
    def test_to_dict_keys(self, app):
        with app.app_context():
            t = Todo(title="Model test")
            _db.session.add(t)
            _db.session.commit()
            d = t.to_dict()
        assert set(d.keys()) == {"id", "title", "completed", "created_at"}

    def test_to_dict_values(self, app):
        with app.app_context():
            t = Todo(title="Value check")
            _db.session.add(t)
            _db.session.commit()
            d = t.to_dict()
        assert d["title"] == "Value check"
        assert d["completed"] is False
        assert isinstance(d["created_at"], str)
        assert isinstance(d["id"], int)
