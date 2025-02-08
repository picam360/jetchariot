var create_plugin = (function () {
	var m_plugin_host = null;
	var m_options = null;
	var m_is_init = false;
	var m_event_handler = null;
	var m_bullets = [];
	var m_warp_tilt = 0;
	var m_osg_enabled = false;
	var m_view_quat = [0,0,0,1];
	
	var m_mode = "JIS";

	var STARTING_TIMEOUT = 60;
	var PLAYTING_TIMEOUT = 180;

	var VEHICLE_DOMAIN = UPSTREAM_DOMAIN + "jetchariot_service.";

	function cal_current_pitch_yaw_deg() {
		var view_offset_quat = m_plugin_host.get_view_offset()
			|| new THREE.Quaternion();
		var view_quat = m_plugin_host.get_view_quat()
			|| new THREE.Quaternion();
		var quat = view_offset_quat.multiply(view_quat);
		return calPitchYawDegree(quat);
	}
	
	function base64encode_binary(data){
		return btoa([...data].map(n => String.fromCharCode(n)).join(""));
	}

	var m_objs = [
		{
			url : "/amf/bullet.amf",
			obj_id : "bullet",
			obj : null,
			default_color : "0.6,0.0,0.0,1.0",
			prepared : false,
		},
	];

	function load_objs(idx){
		if(idx === undefined){
			idx = 0;
		}else if(idx >= m_objs.length){
			return;
		}
		var base_url = "plugins-ext/jetchariot";
		if(m_objs[idx].url){
			var getFile = m_plugin_host.getFile;
			if(m_plugin_host.getFileFromUpstream){
				getFile = m_plugin_host.getFileFromUpstream;
			}
			getFile(base_url + m_objs[idx].url, (data) => {
				if(Array.isArray(data)){
					data = data[0];
				}
				m_objs[idx].obj = base64encode_binary(data);
				m_objs[idx].prepared = true;
				load_objs(idx + 1);
			});
		}else{
			m_objs[idx].prepared = true;
			load_objs(idx + 1);
		}
	}

	function upload_objs(pstcore, pst){
		var json = {
			nodes : [],
		};
		for(var node of m_objs){
			json.nodes.push({
				obj : node.obj,
				default_color : node.default_color,
				smooth_shading : false,
				obj_id : node.obj_id,
			});
		}
		var json_str = JSON.stringify(json);
		pstcore.pstcore_set_param(pst, "renderer", "overlay_obj", json_str);
	}

	function set_bullets(bullets){
		var scale = 0.2;
		var jobj = {
			"id" : "bullets",
			"nodes" : []
		};
		for(const info of bullets){
			jobj.nodes.push({
				"obj_scale" : scale,
				"obj_pos" : `${info.pos.x},${-info.pos.y},${info.pos.z}`,
				"obj_quat" : "0,0,0,1",
				"use_light" : true,
				"blend" : false,
				"obj_id" : "bullet",
			});
		}
		m_pstcore.pstcore_set_param(m_pst, "renderer", "overlay", JSON.stringify(jobj));
	}

	var m_imgs = [
		{
			url : "/img/title.png",
			format : "png",
			tex_id : "title",
			tex : null,
			prepared : false,
		},
	];
	function load_imgs(idx){
		if(idx === undefined){
			idx = 0;
		}else if(idx >= m_imgs.length){
			return;
		}
		var base_url = "plugins-ext/jetchariot";
		if(m_imgs[idx].url){
			var getFile = m_plugin_host.getFile;
			if(m_plugin_host.getFileFromUpstream){
				getFile = m_plugin_host.getFileFromUpstream;
			}
			getFile(base_url + m_imgs[idx].url, (data) => {
				if(Array.isArray(data)){
					data = data[0];
				}
				m_imgs[idx].tex = base64encode_binary(data);
				m_imgs[idx].prepared = true;
				load_imgs(idx + 1);
			});
		}else{
			m_imgs[idx].prepared = true;
			load_imgs(idx + 1);
		}
	}

	function upload_imgs(pstcore, pst){
		var tex_json = {
			nodes : [],
		};
		for(var node of m_imgs){
			tex_json.nodes.push({
				format : node.format,
				tex_id : node.tex_id,
				tex : node.tex,
			});
		}
		var tex_json_str = JSON.stringify(tex_json);
		pstcore.pstcore_set_param(pst, "renderer", "overlay_tex", tex_json_str);
	}

	function push_str(nodes, str, x, y, z, w, coodinate){
		if(app.get_xrsession && app.get_xrsession()){
			push_str_on_space(nodes, str, x, y, z, w, coodinate);
		}else{
			push_str_on_display(nodes, str, x, y, z, w, coodinate);
		}
	}
	function push_str_on_display(nodes, str, x, y, z, w, coodinate){
		var offset = 0;
		switch(coodinate){
			case "left":
				offset = 0;
				break;
			case "right":
				offset = -w*str.length;
				break;
			case "center":
			default:
				offset = -w*str.length/2;
				break;
		}
		const INT_MAX = 0x7FFFFFFF;
		for(var i=0;i<str.length;i++){
			nodes.push({
				width : w,
				height : w*1.25,
				x : x + w*i + offset,
				y,
				z : (z > 1 ? z : INT_MAX),
				tex_id : `ascii[${str.charCodeAt(i)}]`,
			});
		}
	}
	function push_str_on_space(nodes, str, x, y, z, w, coodinate){
		w /= 16;

		var offset = 0;
		switch(coodinate){
			case "left":
				offset = 0;
				break;
			case "right":
				offset = -w*str.length;
				break;
			case "center":
			default:
				offset = -w*str.length/2 + w/2;
				break;
		}
		for(var i=0;i<str.length;i++){
			nodes.push({
				obj_scale : 1.0*w/2,
				obj_pos : `${(x-50)/16 + w*i + offset},${(y-50)/20},${(z-10)/5 + 5}]`,
				tex_id : `ascii[${str.charCodeAt(i)}]`,
				obj_id : "board",
			});
		}
	}

	var m_wait_play_start_mode = "start";
	function wait_play_start(timeout_callback){
		m_event_handler = (sender, key, new_state) => {
			var view_tilt = cal_current_pitch_yaw_deg()[0];
			if(view_tilt < m_warp_tilt){
				return;
			}
			if(!new_state){//fail safe
				return;
			}
			if(!new_state[key]){//only push
				return;
			}
			var cmd = "";
			switch(key){
				case "10_BUTTON_PUSHED":
					cmd = "cancel";
					break;
				case "11_BUTTON_PUSHED":
					cmd = "ok";
					break;
				case "3_AXIS_BACKWARD":
					cmd = "up";
					break;
				case "3_AXIS_FORWARD":
					cmd = "down";
					break;
				case "2_AXIS_BACKWARD":
					cmd = "left";
					break;
				case "2_AXIS_FORWARD":
					cmd = "right";
					break;
				//quest touch : 3_BUTTON stick, 4_BUTTON A, 5_BUTTON B
				case "LEFT_3_BUTTON_PUSHED":
					if(new_state[key]){
						cmd = "cancel";
					}
					break;
				case "RIGHT_3_BUTTON_PUSHED":
					if(new_state[key]){
						cmd = "ok";
					}
					break;
				case "RIGHT_3_AXIS_FORWARD":
					if(new_state[key]){
						cmd = "down";
					}
					break;
				case "RIGHT_3_AXIS_BACKWARD":
					if(new_state[key]){
						cmd = "up";
					}
					break;
				case "RIGHT_2_AXIS_FORWARD":
					if(new_state[key]){
						cmd = "left";
					}
					break;
				case "RIGHT_2_AXIS_BACKWARD":
					if(new_state[key]){
						cmd = "right";
					}
					break;
			}
			if(cmd && sender.toUpperCase() != "OSG" && m_osg_enabled){
				m_osg_enabled = false;
				m_pstcore.pstcore_set_param(m_pst, "osg", "enabled", "0");
			}
			switch(m_wait_play_start_mode){
				case "yoko_senkai":
					switch(cmd){
						case "down":
							m_wait_play_start_mode = "tate_senkai";
							break;
						case "ok":
							m_mode = "JIS";
							break;
					}
					break;
				case "tate_senkai":
					switch(cmd){
						case "up":
							m_wait_play_start_mode = "yoko_senkai";
							break;
						case "down":
							m_wait_play_start_mode = "start";
							break;
						case "ok":
							m_mode = "CAT";
							break;
					}
					break;
				case "start":
					switch(cmd){
						case "up":
							m_wait_play_start_mode = "tate_senkai";
							break;
						case "ok":
							m_state_st -= 1000000;
							break;
					}
					break;
			}
		};
		var overlay_json = {
			nodes : [],
		};
		if(app.get_xrsession && app.get_xrsession()){
			overlay_json.nodes.push({
				obj_scale : 2,
				obj_pos : "0,-2,5",
				tex_id : "title",
				obj_id : "board",
				obj_quat : "0,0,0,1",
			});
		}else{
			overlay_json.nodes.push({
				width : 100,
				height : 25,
				x : 0,
				y : 0,
				z : 10,
				tex_id : "title",
			});
		}

		var cur_y = 0;
		var font_size = [ 4, 4, 4 ];
		var z_pos = [ 10, 10, 10 ];

		if(m_wait_play_start_mode == "yoko_senkai"){
			cur_y = 65;
			font_size[0] = 5;
			z_pos[0] = 5;
		}
		if(m_wait_play_start_mode == "tate_senkai"){
			cur_y = 70;
			font_size[1] = 5;
			z_pos[1] = 5;
		}
		if(m_wait_play_start_mode == "start"){
			cur_y = 80;
			font_size[2] = 5;
			z_pos[2] = 5;
		}

		push_str(overlay_json.nodes, "CONTROLLER MODE", 50, 60, 10, 4);
		if(m_mode == "JIS"){
			push_str(overlay_json.nodes, "[*]Option1", 50, 65, z_pos[0], font_size[0]);
			push_str(overlay_json.nodes, "[ ]Option2", 50, 70, z_pos[1], font_size[1]);
		}else{
			push_str(overlay_json.nodes, "[ ]Option1", 50, 65, z_pos[0], font_size[0]);
			push_str(overlay_json.nodes, "[*]Option2", 50, 70, z_pos[1], font_size[1]);
		}

		push_str(overlay_json.nodes, "START", 50, 80, z_pos[2], font_size[2]);

		if(cur_y > 0){
			push_str(overlay_json.nodes, ">>", 10, cur_y, 5, 5);
			push_str(overlay_json.nodes, "<<", 90, cur_y, 5, 5);
		}

		var now = new Date().getTime();
		var elapsed_sec = (now - m_state_st) / 1e3;
		var remain = STARTING_TIMEOUT - elapsed_sec;
		if(remain > 0){
			push_str(overlay_json.nodes, "TIMEOUT", 50, 40, 20, 4);
			push_str(overlay_json.nodes, remain.toFixed(0), 50, 45, 20, 4);
			m_pstcore.pstcore_set_param(m_pst, "renderer", "overlay", JSON.stringify(overlay_json));
		}else{
			timeout_callback();
		}
	}

	function getPitchYawFromQuaternion(q) {
		// クォータニオンを作成
		const quaternion = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
	
		// 初期ベクトルを定義（上方向が基準）
		const initialVec = new THREE.Vector3(0, -1, 0);
	
		// 回転行列をクォータニオンから取得してベクトルを変換
		const rotatedVec = initialVec.applyQuaternion(quaternion);
	
		// ベクトルを正規化
		rotatedVec.normalize();
	
		// ピッチ（Y軸上の回転角）を計算
		const pitch = Math.acos(-rotatedVec.y) * (180 / Math.PI);

		// ヨー（Y軸周りの回転角）を計算
		const yaw = Math.atan2(rotatedVec.x, -rotatedVec.z) * (180 / Math.PI);
	
		return [pitch - 90, yaw];
	}

	function playing(timeout_callback){
		m_event_handler = (sender, key, new_state) => {
			var view_tilt = cal_current_pitch_yaw_deg()[0];
			if(view_tilt < m_warp_tilt){
				return;
			}
			if(!new_state){//fail safe
				return;
			}
			var bullet = false;
			if(new_state["10_BUTTON_PUSHED"] || new_state["11_BUTTON_PUSHED"]){
				bullet = true;
			}
			//quest touch : 0_BUTTON trriger, 1_BUTTON grip, 3_BUTTON axis
			if(new_state["LEFT_3_BUTTON_PUSHED"] || new_state["RIGHT_3_BUTTON_PUSHED"]){
				bullet = true;
			}
			if (bullet) {
				const [ pitch_deg, cam_yaw_deg ] = getPitchYawFromQuaternion(m_view_quat);
				const yaw_deg = cam_yaw_deg + m_odom.odom.heading;
				const speed = 2;
				const speed_h = speed * Math.cos(Math.PI*pitch_deg/180);
				const speed_v = speed * Math.sin(Math.PI*pitch_deg/180);
				//world coordinate
				m_bullets.push({
					pos : {
						x : 0.5 * Math.sin(Math.PI*yaw_deg/180) + m_odom.odom.x,
						y : 0.0,
						z : 0.5 * Math.cos(Math.PI*yaw_deg/180) + m_odom.odom.z,
					},
					speed : {
						x : speed_h * Math.sin(Math.PI*yaw_deg/180),
						y : speed_v,
						z : speed_h * Math.cos(Math.PI*yaw_deg/180),
					}
				});
			}

			var table;
			{
				//https://gamepad-tester.com/
				table = {
					"0_AXIS_PERCENT": "LeftHorizon",
					"1_AXIS_PERCENT": "LeftVertical",
					"2_AXIS_PERCENT": "RightHorizon",
					"3_AXIS_PERCENT": "RightVertical",
					"4_BUTTON_PUSHED": "LeftBackOpt",
					"5_BUTTON_PUSHED": "RightBackOpt",
					"6_BUTTON_PERCENT": "LeftBack",
					"7_BUTTON_PERCENT": "RightBack",
					//quest touch
					"LEFT_2_AXIS_PERCENT": "LeftHorizon",
					"LEFT_3_AXIS_PERCENT": "LeftVertical",
					"RIGHT_2_AXIS_PERCENT": "RightHorizon",
					"RIGHT_3_AXIS_PERCENT": "RightVertical",
					"LEFT_0_BUTTON_PUSHED": "LeftBackOpt",
					"RIGHT_0_BUTTON_PUSHED": "RightBackOpt",
					"LEFT_1_BUTTON_PERCENT": "LeftBack",
					"RIGHT_1_BUTTON_PERCENT": "RightBack",
				};
			}
			if (table[key]) {
				if(sender.toUpperCase() != "OSG" && m_osg_enabled){
					m_osg_enabled = false;
					m_pstcore.pstcore_set_param(m_pst, "osg", "enabled", "0");
				}
				var value = new_state[key].toFixed(0);
				if(table[key] == "RightHorizon"){
					if(value > 50){
						m_vehicle_cmd = "turn_left";
					}else if(value < -50){
						m_vehicle_cmd = "turn_right";
					}else{
						m_vehicle_cmd = "stop";
					}
					console.log(m_vehicle_cmd);
				}
				if(table[key] == "RightVertical"){
					if(value > 50){
						m_vehicle_cmd = "move_forward";
					}else if(value < -50){
						m_vehicle_cmd = "move_backward";
					}else{
						m_vehicle_cmd = "stop";
					}
					console.log(m_vehicle_cmd);
				}
			}
		};

		var overlay_json = {
			nodes : [],
		};
		var now = new Date().getTime();
		var elapsed_sec = (now - m_state_st) / 1e3;
		var remain = PLAYTING_TIMEOUT - elapsed_sec;
		if(remain > 0){
			var y_offset = 0;
			if(app.get_xrsession && app.get_xrsession()){
				y_offset = 20;
			}
			push_str(overlay_json.nodes, "Time  : ", 40, 5 + y_offset, 10, 4, "left");
			push_str(overlay_json.nodes, remain.toFixed(0) + "sec", 95, 5 + y_offset, 10, 4, "right");
			push_str(overlay_json.nodes, "Score : ", 40, 10 + y_offset, 10, 4, "left");
			push_str(overlay_json.nodes, m_score + "pt ", 95, 10 + y_offset, 10, 4, "right");
			m_pstcore.pstcore_set_param(m_pst, "renderer", "overlay", JSON.stringify(overlay_json));
		}else{
			timeout_callback();
		}
	}

	function open_webdis(url, callback){

		const socket = new WebSocket(url);
		socket.channel_callbacks = {};

		socket.onmessage = function(event) {
			const msg = JSON.parse(event.data);
			if(!msg["SUBSCRIBE"] || msg["SUBSCRIBE"][0] != "message"){
				return;
			}
			const channel = msg["SUBSCRIBE"][1];
			if(socket.channel_callbacks[channel]){
				const data = msg["SUBSCRIBE"][2];
				socket.channel_callbacks[channel](data);
			}
		};

		socket.onopen = function() {
			console.log("webdis connection established");
			callback(socket);
		};

		socket.onclose = function() {
			console.log("webdis connection closed");
		};

		socket.onerror = function(error) {
			console.log(`Error: ${error.message}`);
		};
	}
	function subscribe(socket, channel, callback){
		socket.channel_callbacks[channel] = callback;
		socket.send(JSON.stringify(["SUBSCRIBE", channel]));
	}

	var m_state = "none";
	var m_state_st = 0;
	var m_vehicle_cmd = "stop";
	var m_odom = {
		x : 0,
		y : 0,
		heading : 0,
	};
	var m_pst = 0;
	var m_pstcore = null;
	var m_score = 0;
	function init() {
		m_state = "webdis";
		var state_poling = setInterval(() => {
			switch(m_state){
				case "webdis":
					if(m_options.webdis_url){
						open_webdis(m_options.webdis_url, (socket) => {
							setInterval(() => {
								socket.send(JSON.stringify([
									"PUBLISH", 
									"pserver-vehicle-wheel", 
									`CMD ${m_vehicle_cmd}`
								]));
							}, 100);
						});
						open_webdis(m_options.webdis_url, (socket) => {
							subscribe(socket, "pserver-odometry-info", (data) => {
								const info = JSON.parse(data);
								if(info.state == "UPDATE_ODOMETRY"){
									m_odom = JSON.parse(data);
									//console.log(m_odom);
								}
							});
						})
					}
					m_state = "load_objs";
					break;
				case "load_objs":
					load_objs();
					m_state = "wait_load_objs";
					break;
				case "wait_load_objs":
					if(m_objs[m_objs.length - 1].prepared){
						m_state = "load_imgs";
					}
					break;
				case "load_imgs":
					load_imgs();
					m_state = "wait_load_imgs";
					break;
				case "wait_load_imgs":
					if(m_imgs[m_imgs.length - 1].prepared){
						m_state = "wait_pst";
					}
					break;
				case "wait_pst":
					m_pst = app.get_pst();
					if(m_pst){
						m_pstcore = app.get_pstcore();
						m_pstcore.pstcore_add_set_param_done_callback(m_pst, (pst_name, param, value)=>{
							if(pst_name == "jetchariot_service"){
								if(param == "score"){
									m_score = value;
								}
							}
							if(pst_name == "renderer"){
								if(param == "view_quat"){
									const ary = value.split(',');
									m_view_quat = [
										parseFloat(ary[0]),
										parseFloat(ary[1]),
										parseFloat(ary[2]),
										parseFloat(ary[3]),
									];
								}
							}
							if(pst_name == "warp"){
								if(param == "tilt"){
									m_warp_tilt = parseFloat(value);
								}
							}
						});
						{
							m_osg_enabled = true;
							m_pstcore.pstcore_set_param(m_pst, "osg", "enabled", "1");
						}

						upload_objs(m_pstcore, m_pst);
						upload_imgs(m_pstcore, m_pst);
						m_state_st = new Date().getTime();
						m_state = "wait_play_start";

						setInterval(() => {
							set_bullets(m_bullets);
							const bullets = [];
							for(const info of m_bullets){
								info.pos.x += info.speed.x * 0.1;
								info.pos.y += info.speed.y * 0.1;
								info.pos.z += info.speed.z * 0.1;
								if(info.pos.y > -0.5 && info.pos.z < 10){
									bullets.push(info);
								}
								info.speed.y -= 0.05 * 9.8 * 0.1;//gravity
								info.speed.x -= info.speed.x * 0.01;//air
								info.speed.y -= info.speed.y * 0.01;//air
								info.speed.z -= info.speed.z * 0.01;//air
								
							}
							m_bullets = bullets;
						},100);
					}
					break;
				case "wait_play_start":
					wait_play_start(() => {
						m_state_st = new Date().getTime();
						m_state = "start_play";
					});
					break;
				case "start_play":
					m_pstcore.pstcore_set_param(m_pst, "renderer", "overlay", "");
					m_state_st = new Date().getTime();
					m_state = "playing";
					break;
				case "playing":
					playing(() => {
						m_state_st = new Date().getTime();
						m_state = "end_play";
					});
					break;
				case "end_play":
					{
						var overlay_json = {
							nodes : [],
						};
						push_str(overlay_json.nodes, "TIME UP", 50, 45, 10, 4);
						push_str(overlay_json.nodes, `SCORE : ${m_score}pt`, 50, 55, 5, 4);
						m_pstcore.pstcore_set_param(m_pst, "renderer", "overlay", JSON.stringify(overlay_json));

						var cmd = VEHICLE_DOMAIN + "reset";
						m_plugin_host.send_command(cmd);
						
						m_event_handler = null;
					}
					break;
			}
		}, 100);
	}

	return function (plugin_host) {
		m_plugin_host = plugin_host;
		var plugin = {
            init_options: function (options) {
                m_options = options["jetchariot"] || {};
                m_options = JSON.parse(JSON.stringify(m_options).replace("${window.location.hostname}", window.location.hostname));

				if (!m_is_init) {
					m_is_init = true;
					init();
				}
			},
			event_handler : function(sender, event, state) {
				if(m_event_handler){
					m_event_handler(sender, event, state);
				}
			},
		};
		return plugin;
	}
})();