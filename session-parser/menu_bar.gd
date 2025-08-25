extends MenuBar

@export var hbox:HBoxContainer
@export var main:Control

func _ready() -> void:
	var file_menu_btn:MenuButton = MenuButton.new()
	file_menu_btn.text = "File"
	hbox.add_child(file_menu_btn)
	
	var file_menu:PopupMenu = file_menu_btn.get_popup()
	file_menu.add_item("Open packed")
	file_menu.add_item("Save packed")
	file_menu.add_separator()
	
	file_menu.add_item("Quit")
	file_menu.id_pressed.connect(Callable(self, "_on_menu_item_pressed").bind(file_menu))
	
	var view_menu_btn:MenuButton = MenuButton.new()
	view_menu_btn.text = "View"
	hbox.add_child(view_menu_btn)
	
	var view_menu:PopupMenu = view_menu_btn.get_popup()
	view_menu.add_check_item("Show displayname")
	
	var chunk_menu_btn:MenuButton = MenuButton.new()
	chunk_menu_btn.text = "Chunk"
	hbox.add_child(chunk_menu_btn)
	
	var chunk_menu:PopupMenu = chunk_menu_btn.get_popup()
	chunk_menu.add_item("Next chunk")
	chunk_menu.add_item("Last chunk")
	

func _on_menu_item_pressed(id, popup_menu):
	var item_text = popup_menu.get_item_text(id)
	print("Menu item selected:", item_text)
	match item_text:
		"Open packed":
			main.open_json_action()
			pass
		"Save packed":
			print("TODO: Save packed")
		"Quit":
			get_tree().quit()
		"Next chunk":
			main.load_next_chunk()
		"Last chunk":
			main.load_previous_chunk()
		_:
			print("Unknown menu item")
		
