extends Control

@export_category("File")
var zip_reader: ZIPReader
var chunk_files: Array[String] = []
var current_chunk_index: int = 0
var loaded_chunks: Array[Dictionary] = []

@export_category("Messages")
@export var messages:Array = []

var filedialog:PackedScene = preload("res://Scenes/FileManagement/open_dialog.tscn")
var markdownlabel:PackedScene = preload("res://Scenes/MessageExplorer/MessageLabel.tscn")


func _process(_delta: float) -> void:
	if Input.is_action_just_released("open_json"):
		open_json_action()
	elif Input.is_action_just_pressed("quit"):
		get_tree().quit()
	elif Input.is_action_just_pressed("force_quit"):
		OS.kill(OS.get_process_id())
	elif Input.is_action_just_pressed("next_chunk"):
		load_next_chunk()
	elif Input.is_action_just_pressed("last_chunk"):
		load_previous_chunk()


func open_json_action() -> void:
	var filedialog_instance: FileDialog = filedialog.instantiate()
	self.add_child(filedialog_instance)

	filedialog_instance.access = FileDialog.ACCESS_FILESYSTEM
	filedialog_instance.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	filedialog_instance.filters = PackedStringArray(["*.zip ; Zip files"])

	filedialog_instance.file_selected.connect(_on_file_selected)
	filedialog_instance.show()
	


func _on_file_selected(path: String) -> void:
	$%ParsingLabel.show()
	
	zip_reader = ZIPReader.new()
	if zip_reader.open(path) != OK:
		push_error("Failed to open zip file: %s" % path)
		return
	
	chunk_files.clear()
	for file_name in zip_reader.get_files():
		if file_name.ends_with(".json"):
			chunk_files.append(file_name)
	chunk_files.sort() # Ensure ordered chunks
	
	if chunk_files.is_empty():
		push_warning("No JSON chunks found in zip.")
		return
	
	current_chunk_index = 0
	loaded_chunks.clear()
	
	# Load first 2 chunks if available
	load_chunk_at(current_chunk_index)
	if chunk_files.size() > 1:
		load_chunk_at(current_chunk_index + 1)
	
	refresh_messages()
	$%ParsingLabel.hide()


func load_chunk_at(index: int) -> void:
	if index < 0 or index >= chunk_files.size():
		return
	var file_name = chunk_files[index]
	var json_string = zip_reader.read_file(file_name).get_string_from_utf8()
	var json := JSON.new()
	if json.parse(json_string) == OK:
		loaded_chunks.append(json.data)
	else:
		push_warning("Failed to parse chunk: %s" % file_name)


func unload_first_chunk() -> void:
	if not loaded_chunks.is_empty():
		loaded_chunks.pop_front()


func unload_last_chunk() -> void:
	if not loaded_chunks.is_empty():
		loaded_chunks.pop_back()


func load_next_chunk() -> void:
	if current_chunk_index + 2 >= chunk_files.size():
		print("Reached end of chunks")
		return
	current_chunk_index += 1
	unload_first_chunk()
	load_chunk_at(current_chunk_index + 1)
	refresh_messages()
	$%CurrentChunk.text = "Current chunk: %s:%s" % [current_chunk_index, current_chunk_index+1]


func load_previous_chunk() -> void:
	if current_chunk_index <= 0:
		print("At beginning of chunks")
		return
	current_chunk_index -= 1
	unload_last_chunk()
	load_chunk_at(current_chunk_index)
	refresh_messages()
	$%CurrentChunk.text = "Current chunk: %s:%s" % [current_chunk_index, current_chunk_index+1]


func refresh_messages() -> void:
	messages.clear()
	for chunk in loaded_chunks:
		if chunk.has("messages"):
			messages.append_array(chunk["messages"])
	
	var msg_count:int = messages.size()
	update_total_messages_counter(msg_count)
	create_message_labels()


func create_message_labels() -> void:
	var container: VBoxContainer = $%VBoxContainer
	for child in container.get_children():
		if child is MarkdownLabel:
			child.call_deferred("free")
	
	for message in messages:
		var message_dict: Dictionary = message
		
		var author: Dictionary = message_dict.get("author", {}) as Dictionary
		var username: String = str(author.get("name", "<unknown>")).strip_edges()
		if username.is_empty():
			username = "<unknown>"
		
		var message_content: String = str(message_dict.get("content", "<no content>")).strip_edges()
		if message_content.is_empty():
			message_content = "<no content>"
		
		var safe_text: String = "%s: %s" % [username, message_content]
		
		
		
		var userid: String = message_dict.get("id", str(randi()))
		
		var new_label: MarkdownLabel = markdownlabel.instantiate()
		new_label.name = userid
		if safe_text != "":
			new_label.markdown_text = safe_text
		else:
			new_label.markdown_text = "<no content>"
		$%VBoxContainer.add_child(new_label)


func update_total_messages_counter(amount:int) -> void:
	$%TotalMessages.text = "Loaded messages: %s" % str(amount)
	$%CurrentChunk.text = "Loaded chunks: %s:%s" % [current_chunk_index, current_chunk_index+1]
	$%CurrentChunk.show()
	
	$%ScrollContainer.set_deferred("scroll_vertical", 0)
