extends ScrollContainer

func _ready() -> void:
	center_self()

func center_self() -> void:
	var parent_control = get_parent() as Control
	if parent_control == null:
		return
	
	# Calculate position to center this ScrollContainer in its parent
	var new_pos = Vector2()
	new_pos.x = (parent_control.get_size().x - get_size().x) / 2
	new_pos.y = (parent_control.get_size().y - get_size().y) / 2
	
	position = new_pos
