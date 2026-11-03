import os
from flask import Flask, jsonify, request, abort
from flask_cors import CORS
from database import init_db, db
from models import Todo

app = Flask(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
app.config["SQLALCHEMY_DATABASE_URI"] = (
    f"sqlite:///{os.path.join(BASE_DIR, 'instance', 'todos.db')}"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# ── CORS ───────────────────────────────────────────────────────────────────────
CORS(app)

# ── Database ───────────────────────────────────────────────────────────────────
os.makedirs(os.path.join(BASE_DIR, "instance"), exist_ok=True)
init_db(app)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/api/todos")
def get_todos():
    """Return all todos ordered by creation date descending."""
    todos = Todo.query.order_by(Todo.created_at.desc()).all()
    return jsonify([t.to_dict() for t in todos])


@app.post("/api/todos")
def create_todo():
    """Create a new todo. Body: { "title": "..." }"""
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400

    todo = Todo(title=title)
    db.session.add(todo)
    db.session.commit()
    return jsonify(todo.to_dict()), 201


@app.patch("/api/todos/<int:todo_id>")
def toggle_todo(todo_id):
    """Toggle the completed state of a todo."""
    todo = db.session.get(Todo, todo_id) or abort(404)
    todo.completed = not todo.completed
    db.session.commit()
    return jsonify(todo.to_dict())


@app.put("/api/todos/<int:todo_id>")
def update_todo(todo_id):
    """Full update of a todo. Body: { "title": "...", "completed": true|false }"""
    todo = db.session.get(Todo, todo_id) or abort(404)
    data = request.get_json(silent=True) or {}

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            return jsonify({"error": "title must not be empty"}), 400
        todo.title = title

    if "completed" in data:
        if not isinstance(data["completed"], bool):
            return jsonify({"error": "completed must be a boolean"}), 400
        todo.completed = data["completed"]

    db.session.commit()
    return jsonify(todo.to_dict())


@app.delete("/api/todos/<int:todo_id>")
def delete_todo(todo_id):
    """Delete a todo."""
    todo = db.session.get(Todo, todo_id) or abort(404)
    db.session.delete(todo)
    db.session.commit()
    return "", 204


# ── Error handlers ─────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    db.session.rollback()
    return jsonify({"error": "internal server error"}), 500


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True)
