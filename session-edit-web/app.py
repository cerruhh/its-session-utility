import logging

import os
import zipfile
import io
import json
import sqlite3
# from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file, session, abort


app = Flask(__name__)
app.secret_key = "supersecretkey"

UPLOAD_FOLDER = "uploads"
EXTRACT_FOLDER = "extracted"
SAVE_FOLDER = "saved"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXTRACT_FOLDER, exist_ok=True)
os.makedirs(SAVE_FOLDER, exist_ok=True)
logging.basicConfig(level=logging.INFO)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file or not file.filename.endswith(".zip"):
        return jsonify({"error": "Invalid file format"}), 400

    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    extract_path = os.path.join(EXTRACT_FOLDER, os.path.splitext(file.filename)[0])
    if os.path.exists(extract_path):
        for root, dirs, files in os.walk(extract_path, topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
    with zipfile.ZipFile(filepath, 'r') as z:
        z.extractall(extract_path)

    json_files = sorted([f for f in os.listdir(extract_path) if f.endswith(".json")])
    db_files = [f for f in os.listdir(extract_path) if f.endswith(".db")]

    if not json_files or "packed_images.db" not in db_files:
        return jsonify({"error": "Invalid archive: needs .json files and packed_images.db"}), 400

    session["json_files"] = json_files
    session["extract_path"] = extract_path
    session["current_index"] = 0

    return jsonify({"message": "File loaded", "chunk_index": 0})


def load_chunk(idx):
    json_files = session.get("json_files", [])
    extract_path = session.get("extract_path")
    if not json_files or not extract_path:
        return None
    if idx < 0 or idx >= len(json_files):
        return None

    path = os.path.join(extract_path, json_files[idx])
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.route("/get_chunk")
def get_chunk():
    idx = session.get("current_index", 0)
    data = load_chunk(idx)
    if not data:
        return jsonify({"error": "No file loaded"}), 400
    return jsonify({"chunk_index": idx, "data": data})

# Recents
@app.route("/list_recents")
def list_recents():
    # list directories inside extracted/
    recents = []
    for name in sorted(os.listdir(EXTRACT_FOLDER)):
        path = os.path.join(EXTRACT_FOLDER, name)
        if os.path.isdir(path):
            json_files = [f for f in os.listdir(path) if f.endswith(".json")]
            db_files = [f for f in os.listdir(path) if f.endswith(".db")]
            if json_files and "packed_images.db" in db_files:
                recents.append(name)
    return jsonify(recents)


@app.route("/load_recent", methods=["POST"])
def load_recent():
    folder = request.json.get("folder")
    extract_path = os.path.join(EXTRACT_FOLDER, folder)
    if not os.path.exists(extract_path):
        return jsonify({"error": "Folder not found"}), 404

    json_files = sorted([f for f in os.listdir(extract_path) if f.endswith(".json")])
    db_files = [f for f in os.listdir(extract_path) if f.endswith(".db")]
    if not json_files or "packed_images.db" not in db_files:
        return jsonify({"error": "Invalid extracted folder"}), 400

    session["json_files"] = json_files
    session["extract_path"] = extract_path
    session["current_index"] = 0

    data = load_chunk(0)
    return jsonify({"message": "Recent loaded", "chunk_index": 0, "data": data})


@app.route("/navigate", methods=["POST"])
def navigate():
    direction = request.json.get("direction")
    idx = session.get("current_index", 0)
    json_files = session.get("json_files", [])
    if not json_files:
        return jsonify({"error": "No file loaded"}), 400

    if direction == "first":
        idx = 0
    elif direction == "last":
        idx = len(json_files) - 1
    elif direction == "forward":
        idx = min(idx + 1, len(json_files) - 1)
    elif direction == "backward":
        idx = max(idx - 1, 0)
    elif direction == "reload":
        pass

    session["current_index"] = idx
    data = load_chunk(idx)
    return jsonify({"chunk_index": idx, "data": data})


@app.route('/attachment/<path:attachment_id>')
def get_attachment(attachment_id):
    db_path = os.path.join(session["extract_path"], 'packed_images.db')
    if not os.path.exists(db_path):
        return jsonify({"error": "Database not found", "info": f"upload_folder: {db_path} , extract_folder: {session["extract_path"]}"}), 404

    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    # ✅ only use the last segment if prefixed with "attachments/"
    if attachment_id.startswith("attachments/"):
        attachment_id = attachment_id.split("/", 1)[1]

    c.execute("SELECT file_name, mime_type, data FROM attachments WHERE id = ?", (attachment_id,))
    row = c.fetchone()
    conn.close()

    if row:
        file_name, mime_type, blob = row
        return send_file(io.BytesIO(blob), mimetype=mime_type, download_name=file_name)
    else:
        return jsonify({"error": "Attachment not found"}), 404


@app.route("/attachment/<file_id>")
def attachment(file_id):
    print(file_id)
    extract_path = session.get("extract_path")
    logging.info(extract_path)
    if not extract_path:
        abort(404)
    db_path = os.path.join(extract_path, "packed_images.db")
    if not os.path.exists(db_path):
        abort(404)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT file_name, mime_type, data FROM attachments WHERE id = ?", (file_id,))
    print(file_id)
    row = cursor.fetchone()
    conn.close()
    if not row:
        abort(404)

    file_name, mime_type, blob = row
    return send_file(io.BytesIO(blob), mimetype=mime_type, as_attachment=False, download_name=file_name)

@app.route("/save_marked", methods=["POST"])
def save_marked():
    marks = request.json.get("marks", {})
    extract_path = session.get("extract_path")
    if not extract_path:
        return jsonify({"error": "No file loaded"}), 400

    save_path = os.path.join(SAVE_FOLDER, os.path.basename(extract_path))
    os.makedirs(save_path, exist_ok=True)

    for idx, fname in enumerate(session["json_files"]):
        src = os.path.join(extract_path, fname)
        dst = os.path.join(save_path, fname)
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
        # inject marks
        for mi, msg in enumerate(data.get("messages", [])):
            key = f"{idx}:{mi}"
            if key in marks:
                msg["marked"] = True
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # also copy db unchanged for now
    db_src = os.path.join(extract_path, "packed_images.db")
    if os.path.exists(db_src):
        import shutil
        shutil.copy(db_src, save_path)

    return jsonify({"message": "Marked data saved"})

@app.route("/export_save", methods=["POST"])
def export_save():
    marks = request.json.get("marks", {})
    extract_path = session.get("extract_path")
    if not extract_path:
        return jsonify({"error": "No file loaded"}), 400

    # temp folder
    import tempfile, shutil
    temp_dir = tempfile.mkdtemp()

    # process jsons
    kept_attachments = set()
    for idx, fname in enumerate(session["json_files"]):
        src = os.path.join(extract_path, fname)
        dst = os.path.join(temp_dir, fname)
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
        new_msgs = []
        for mi, msg in enumerate(data.get("messages", [])):
            key = f"{idx}:{mi}"
            if key in marks:
                msg["marked"] = True
                new_msgs.append(msg)
                # collect attachment ids
                for att in msg.get("attachments", []):
                    attid = att.replace("db://attachments/","")
                    kept_attachments.add(attid)
        data["messages"] = new_msgs
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # copy db but only keep kept_attachments
    db_src = os.path.join(extract_path, "packed_images.db")
    if os.path.exists(db_src):
        db_dst = os.path.join(temp_dir, "packed_images.db")
        conn_src = sqlite3.connect(db_src)
        conn_dst = sqlite3.connect(db_dst)
        csrc = conn_src.cursor()
        cdst = conn_dst.cursor()
        # recreate schema
        cdst.execute("CREATE TABLE attachments (id TEXT PRIMARY KEY, file_name TEXT, mime_type TEXT, data BLOB)")
        for attid in kept_attachments:
            row = csrc.execute("SELECT id,file_name,mime_type,data FROM attachments WHERE id=?", (attid,)).fetchone()
            if row: cdst.execute("INSERT INTO attachments VALUES (?,?,?,?)", row)
        conn_dst.commit()
        conn_src.close(); conn_dst.close()

    # zip it
    zip_path = os.path.join(SAVE_FOLDER, "exported.zip")
    shutil.make_archive(zip_path.replace(".zip",""), 'zip', temp_dir)
    shutil.rmtree(temp_dir)

    return send_file(zip_path, as_attachment=True)


if __name__ == "__main__":
    app.run(debug=True)
