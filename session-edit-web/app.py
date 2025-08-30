import io
import json
import logging
import os
import shutil
import sqlite3
import zipfile
import re
from datetime import datetime
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


@app.route('/favicon.ico')
def favicon():
    # return empty 204 so browser stops requesting
    return '', 204


def sort_json_files(files):
    # Sort by the first integer found in filename; if none, fall back to filename
    def keyfn(f):
        m = re.search(r'(\d+)', f)
        return (int(m.group(1)), f) if m else (float('inf'), f)

    return sorted(files, key=keyfn)


# --- ensure upload returns json_files list
@app.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file or not file.filename.endswith(".zip"):
        return jsonify({"error": "Invalid file format"}), 400
    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)
    extract_path = os.path.join(EXTRACT_FOLDER, os.path.splitext(file.filename)[0])
    if os.path.exists(extract_path):
        shutil.rmtree(extract_path)
    with zipfile.ZipFile(filepath, 'r') as z:
        z.extractall(extract_path)
    json_files = [f for f in os.listdir(extract_path) if f.endswith(".json")]
    json_files = sort_json_files(json_files)
    db_files = [f for f in os.listdir(extract_path) if f.endswith(".db")]
    if not json_files or "packed_images.db" not in db_files:
        return jsonify({"error": "Invalid archive: needs .json files and packed_images.db"}), 400
    session["json_files"] = json_files
    session["extract_path"] = extract_path
    session["current_index"] = 0
    session["file_count"] = len(json_files)
    data = load_chunk(0)
    return jsonify({
        "message": "File loaded",
        "chunk_index": 0,
        "file_count": len(json_files),
        "data": data,
        "json_files": json_files  # <-- provide filenames to client
    })


# --- update load_chunk to LOG the filename being loaded
def load_chunk(idx):
    json_files = session.get("json_files", [])
    extract_path = session.get("extract_path")
    if not json_files or not extract_path:
        return None
    idx = max(0, min(idx, len(json_files) - 1))
    path = os.path.join(extract_path, json_files[idx])
    app.logger.info("Loading JSON file: %s", path)  # <<-- LOG the currently loaded filename
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["messageCount"] = len(data.get("messages", []))
    return data


@app.route("/get_chunk")
def get_chunk():
    idx = session.get("current_index", 0)
    data = load_chunk(idx)
    if not data:
        return jsonify({"error": "No file loaded"}), 400
    return jsonify(
        {"chunk_index": idx, "file_count": session.get("file_count", len(session.get("json_files", []))), "data": data})


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


@app.route("/list_recent_saves")
def list_recent_saves():
    # list directories inside SAVE_FOLDER
    recents = []
    for name in sorted(os.listdir(SAVE_FOLDER)):
        path = os.path.join(SAVE_FOLDER, name)
        if os.path.isdir(path):
            json_files = [f for f in os.listdir(path) if f.endswith(".json")]
            db_files = [f for f in os.listdir(path) if f.endswith(".db")]
            if json_files and "packed_images.db" in db_files:
                recents.append(name)
    return jsonify(recents)


@app.route("/export_marked", methods=["POST"])
def export_marked():
    marks = request.json.get("marks", {})
    groups = request.json.get("groups", {})
    group_assignments = groups.get("assignments", {})

    extract_path = session.get("extract_path")
    if not extract_path:
        return jsonify({"error": "No file loaded"}), 400

    import tempfile, zipfile, shutil, sqlite3, os, json
    from flask import send_file

    def attachment_id_from_ref(ref: str) -> str:
        s = ref or ""
        if s.startswith("db://"):
            s = s[5:]
        if s.startswith("attachments/"):
            s = s.split("/", 1)[1]
        return s

    with tempfile.TemporaryDirectory() as tmpdir:
        used_attachment_ids = set()
        chunk_files = []

        for idx, fname in enumerate(session["json_files"]):
            src = os.path.join(extract_path, fname)
            with open(src, "r", encoding="utf-8") as f:
                data = json.load(f)

            new_messages = []
            for mi, msg in enumerate(data.get("messages", [])):
                key = f"{idx}:{mi}"
                if key in marks:
                    # copy message and include its group if present in payload
                    new_msg = msg.copy()
                    if key in group_assignments:
                        ga = group_assignments[key]
                        # store group object
                        new_msg["group"] = {}
                        if "id" in ga: new_msg["group"]["id"] = ga["id"]
                        if "name" in ga: new_msg["group"]["name"] = ga["name"]
                        if "color" in ga: new_msg["group"]["color"] = ga["color"]
                    else:
                        new_msg.pop("group", None)
                    new_messages.append(new_msg)

                    # collect referenced attachments
                    for att in msg.get("attachments", []) or []:
                        aid = attachment_id_from_ref(att)
                        if aid:
                            used_attachment_ids.add(aid)

            if new_messages:
                data["messages"] = new_messages
                new_fname = f"{len(chunk_files)}.json"
                dst = os.path.join(tmpdir, new_fname)
                with open(dst, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                chunk_files.append(new_fname)

        # Copy DB and remove unreferenced attachments
        db_src = os.path.join(extract_path, "packed_images.db")
        db_dst = os.path.join(tmpdir, "packed_images.db")
        if os.path.exists(db_src):
            shutil.copy(db_src, db_dst)

            conn = sqlite3.connect(db_dst)
            c = conn.cursor()
            if used_attachment_ids:
                placeholders = ",".join("?" for _ in used_attachment_ids)
                c.execute(
                    f"DELETE FROM attachments WHERE id NOT IN ({placeholders})",
                    tuple(used_attachment_ids),
                )
            else:
                c.execute("DELETE FROM attachments")
            conn.commit()
            c.execute("VACUUM")
            conn.commit()
            conn.close()
        else:
            # If no DB, create an empty attachments DB to avoid missing file in zip
            conn = sqlite3.connect(db_dst)
            c = conn.cursor()
            c.execute("CREATE TABLE attachments (id TEXT PRIMARY KEY, file_name TEXT, mime_type TEXT, data BLOB)")
            conn.commit()
            conn.close()

        # create zip
        zip_path = os.path.join(tmpdir, "marked_export.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for f in chunk_files:
                zipf.write(os.path.join(tmpdir, f), arcname=f)
            zipf.write(db_dst, arcname="packed_images.db")

        return send_file(zip_path, as_attachment=True, download_name="marked_export.zip")


@app.route("/load_recent", methods=["POST"])
def load_recent():
    folder = request.json.get("folder")
    use_save_folder = request.json.get("save_folder", False)
    base_folder = SAVE_FOLDER if use_save_folder else EXTRACT_FOLDER
    extract_path = os.path.join(base_folder, folder)
    if not os.path.exists(extract_path):
        return jsonify({"error": "Folder not found"}), 404
    json_files = [f for f in os.listdir(extract_path) if f.endswith(".json")]
    json_files = sort_json_files(json_files)
    db_files = [f for f in os.listdir(extract_path) if f.endswith(".db")]
    if not json_files or "packed_images.db" not in db_files:
        return jsonify({"error": "Invalid folder"}), 400
    session["json_files"] = json_files
    session["extract_path"] = extract_path
    session["current_index"] = 0
    session["file_count"] = len(json_files)
    data = load_chunk(0)
    return jsonify({
        "message": "Recent loaded",
        "chunk_index": 0,
        "file_count": len(json_files),
        "data": data,
        "json_files": json_files
    })


@app.route("/navigate", methods=["POST"])
def navigate():
    direction = request.json.get("direction")
    json_files = session.get("json_files", [])

    if not json_files:
        return jsonify({"error": "No file loaded"}), 400

    # Sort by the last number in the filename
    def extract_index(filename):
        match = re.findall(r"(\d+)", filename)
        if not match:
            return 0  # fallback if no number is found
        return int(match[-1])  # take the last number

    json_files = sorted(json_files, key=extract_index)
    session["json_files"] = json_files

    idx = session.get("current_index", 0)
    if idx is None or idx < 0 or idx >= len(json_files):
        idx = 0

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
    logging.info(f"Navigating to index {idx}, file {json_files[idx]}")

    return jsonify({
        "chunk_index": idx,
        "file_count": len(json_files),
        "data": data,
        "json_files": json_files
    })


@app.route('/attachment/<path:attachment_id>')
def get_attachment(attachment_id):
    db_path = os.path.join(session["extract_path"], 'packed_images.db')
    if not os.path.exists(db_path):
        return jsonify({"error": "Database not found",
                        "info": f"upload_folder: {db_path} , extract_folder: {session["extract_path"]}"}), 404

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
    marks = request.json.get("marks", {}) or {}
    groups = request.json.get("groups", {}) or {}
    group_assignments = groups.get("assignments", {}) or {}
    extract_path = session.get("extract_path")
    if not extract_path:
        return jsonify({"error": "No file loaded"}), 400
    save_path = os.path.join(SAVE_FOLDER, os.path.basename(extract_path))
    os.makedirs(save_path, exist_ok=True)

    # determine which files are affected (either by marks or group assignments)
    affected_indices = set()
    for k in list(marks.keys()):
        if ":" in k:
            idx = int(k.split(":", 1)[0])
            affected_indices.add(idx)
    for k in list(group_assignments.keys()):
        if ":" in k:
            idx = int(k.split(":", 1)[0])
            affected_indices.add(idx)

    # if none affected then nothing to write, but still ensure DB copied
    if not affected_indices:
        db_src = os.path.join(extract_path, "packed_images.db")
        if os.path.exists(db_src):
            db_dst = os.path.join(save_path, "packed_images.db")
            if os.path.abspath(db_src) != os.path.abspath(db_dst):
                shutil.copyfile(db_src, db_dst)
        return jsonify({"message": "Marked data saved (no JSON changes)"}), 200

    # only rewrite the affected JSON files
    for idx, fname in enumerate(session["json_files"]):
        if idx not in affected_indices:
            # copy untouched file to save folder to keep archive coherent
            src = os.path.join(extract_path, fname)
            dst = os.path.join(save_path, fname)
            # only copy if destination missing or source newer
            try:
                if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
                    shutil.copyfile(src, dst)
            except Exception:
                shutil.copyfile(src, dst)
            continue

        src = os.path.join(extract_path, fname)
        dst = os.path.join(save_path, fname)
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
        for mi, msg in enumerate(data.get("messages", [])):
            key = f"{idx}:{mi}"
            # marks
            if key in marks:
                msg["marked"] = True
            else:
                msg.pop("marked", None)
            # group assignments: store as object {id,name,color}
            if key in group_assignments:
                ga = group_assignments[key]
                gid = ga.get("id")
                gname = ga.get("name") if "name" in ga else None
                gcolor = ga.get("color") if "color" in ga else None
                msg["group"] = {"id": gid}
                if gname is not None:
                    msg["group"]["name"] = gname
                if gcolor is not None:
                    msg["group"]["color"] = gcolor
            else:
                msg.pop("group", None)
        # write modified JSON
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # copy DB once
    db_src = os.path.join(extract_path, "packed_images.db")
    if os.path.exists(db_src):
        db_dst = os.path.join(save_path, "packed_images.db")
        if os.path.abspath(db_src) != os.path.abspath(db_dst):
            shutil.copyfile(db_src, db_dst)

    return jsonify({"message": "Marked data saved"}), 200


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
                    attid = att.replace("db://attachments/", "")
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
            if row:
                cdst.execute("INSERT INTO attachments VALUES (?,?,?,?)", row)
        conn_dst.commit()
        conn_src.close()
        conn_dst.close()

    # zip it
    zip_path = os.path.join(SAVE_FOLDER, "exported.zip")
    shutil.make_archive(zip_path.replace(".zip", ""), 'zip', temp_dir)
    shutil.rmtree(temp_dir)

    return send_file(zip_path, as_attachment=True)


if __name__ == "__main__":
    app.run(debug=True)
