registerPlugin({
	name: 'Twitch Live Checker',
	version: '1.2.0',
	description: 'Checks twitch status and assigns server group, so that users can see if a client is currently streaming.',
	author: 'Jaywalker',
	requiredModules: ["http"],
	vars: [{
		name: 'mode',
		title: 'How twitch streamers in your Teamspeak will be identified',
		type: 'select',
		options: [
			'List',
			'Description']
	}, {
		name: 'userChannels',
		title: 'Each line represents TS3 Unique Ids and Twitch UserIDs (tsID:twitchID)',
		type: 'multiline',
		conditions: [{
			field: 'mode',
			value: 0
		}]
	}, {
		name: 'twitchNameHint',
		title: 'The hint in the description that comes before the twitch name (HINTtwitchID)',
		type: 'string',
		placeholder: 'twitch.tv/',
		conditions: [{
			field: 'mode',
			value: 1
		}]
	}, {
		name: 'interval',
		title: 'Interval (in seconds) Best case not under 30 seconds...',
		type: 'number',
		placeholder: '30'
	}, {
		name: 'twitchLiveGroup',
		title: 'Group-Number of your "Twitch Live Display" Server Group',
		type: 'number',
		placeholder: '123'
	}, {
		name: 'infoChannelMode',
		title: 'Enable a Channel where its description and name show Live streamers',
		type: 'select',
		options: [
			'Disabled',
			'Enabled']
	}, {
		name: 'twitchInfoChannel',
		title: 'Channel-Id where twitch statuses are displayed.',
		type: 'channel',
		conditions: [{
			field: 'infoChannelMode',
			value: 1
		}]
	}, {
		name: 'channelCreateMode',
		title: 'Create Channels for Streamers (of Server Group)',
		type: 'select',
		options: [
			'Disabled',
			'Enabled']
	}, {
		name: 'streamerChannelGroup',
		title: 'Group-Number of your Twitch Live Streamer Group, Leave empty to not filter.',
		type: 'number',
		placeholder: '123',
		conditions: [{
			field: 'channelCreateMode',
			value: 1
		}]
	}, {
		name: 'streamerChannelParent',
		title: 'Under this channel, the Streamer Channels get created',
		type: 'channel',
		conditions: [{
			field: 'channelCreateMode',
			value: 1
		}]
	}, {
		name: 'clientIdTwitch',
		title: 'Your Twitch Dev-App Client ID ( https://twitchtokengenerator.com/ )',
		type: 'string'
	}, {
		name: 'tokenTwitch',
		title: 'Your Twitch Access Token (OAuth)',
		type: 'string'
	}, {
		name: 'outputType',
		title: 'Logging Output-Type',
		type: 'select',
		options: [
			'Log Only',
			'Channel-Chat'
		]
	}, {
		name: 'outputVerbosity',
		title: 'Logging Verbosity',
		type: 'select',
		options: [
			'Errors',
			'Debug'
		]
	}]
}, function (sinusbot, config) {
	//for ts-specific stuff	
	var backend = require('backend');
	//for logging stuff	
	var engine = require('engine');
	//for web stuff
	var http = require("http");
	//var store = require("store");
	const TOKEN = config.tokenTwitch;
	const APIKEY = config.clientIdTwitch;
	var firstRun = true;
	var checkStreamerCount = 0;
	var checkedStreamerCount = 0;
	var onlineStreamer = [];
	var onlineStreamerContent = [];


	function logToOutput(s, isError) {
		//checks the set outputType and either logs to chat or only to the sinus Console
		if (isError || config.outputVerbosity == 1) {
			if (config.outputType == 1) {
				backend.getCurrentChannel().chat(s);
			}
			engine.log(s);
		}
	}
	//when loading the plugin, we split the user info, each line represents the global TS-ID and the twitch username
	if (config.mode == 0) {
		try {
			var tsTwitch = (config && config.userChannels) ? config.userChannels.split('\n').map(function (e) {
				return e.trim().replace(/\r/g, '');
			}) : [];
		} catch (err) {
			logToOutput('Config error (TS-Twitch: ' + err.message, true);
		}
	}

	//function to check if client cl is currently a member of a server group
	function isInGroup(cl, groupIndex) {
		var groups = cl.getServerGroups();
		var found = false;
		for (var i = 0; i < groups.length; i++) {
			if (groups[i].id() == groupIndex) {
				found = true;
				break;
			}
		}
		return found;
	}

	function makeid(length) {
		var result = '';
		var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		var charactersLength = characters.length;
		for (var i = 0; i < length; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}
		return result;
	}

	function getChannelChildren(channel) {
		var children = [];
		var allC = backend.getChannels();
		allC.forEach(c => {
			if (c.parent() != null && c.parent().id() == channel.id()) {
				children.push(c);
			}
		});
		return children;
	}

	function checkLiveStatus(cl, twitchName) {
		//sending a request to twitch helix api with the corresponding twitch username to check if the channel is online
		http.simpleRequest({
			method: 'GET',
			url: 'https://api.twitch.tv/helix/streams?user_login=' + twitchName,
			headers: {
				"Authorization": `Bearer ${TOKEN}`,
				"Client-ID": APIKEY
			},
			timeout: 10 * 1000
		}, function (error, response) {
			if (error) {
				logToOutput('Error: ' + error, true);
			} else if (response.statusCode != 200) {
				logToOutput('HTTP-Error: ' + response.status, true);
			} else {
				//logToOutput('API-GET success', false);
				var res;
				try {
					res = JSON.parse(response.data.toString());
				} catch (err) {
					logToOutput('JSONparse-Error: ' + err.message, true);
				}
				if (res === undefined) {
					logToOutput('Invalid JSON.', true);
				} else {
					//logToOutput('JSON parse success', false);
					if (res.data.length == 0) {
						//stream is offline
						//logToOutput(cl.name() + '\'s Stream is currently offline', false);
						if (isInGroup(cl, config.twitchLiveGroup)) {
							logToOutput('Live group is being removed...', false);
							cl.removeFromServerGroup(config.twitchLiveGroup);
						} else {
							//logToOutput('Live group was already removed.', false);
						}
					} else {
						//stream is online ... probably
						if (res.data[0].type == 'live') {
							logToOutput(cl.name() + '\'s Stream is currently live!', false);
							//stream is definitely online
							if (!isInGroup(cl, config.twitchLiveGroup)) {
								logToOutput('Live group is being applied...', false);
								cl.addToServerGroup(config.twitchLiveGroup);
							} else {
								//logToOutput('Live group was already applied.', false);
							}
							if (!onlineStreamer.includes(twitchName.toLowerCase())) {
								var title = res.data[0].title;
								var thumbNail = res.data[0].thumbnail_url;
								var liveString = "[b][size=14]" + twitchName + "[/size][/b]\r\n" + "[url=https://twitch.tv/" + twitchName + "][img]" + thumbNail + "[/img][/url]\r\n" + title + "\r\n\r\n";
								onlineStreamer.push(twitchName.toLowerCase());
								onlineStreamerContent.push({ "name": twitchName, "desc": liveString, "tsclient": cl });
							}
						}
					}
				}
			}
			checkedStreamerCount++;
		});
	}
	//this is called every (interval) seconds
	setInterval(function () {
		//Check if all Streamers that should have been checked have been checked.
		if (checkStreamerCount != checkedStreamerCount) {
			return;
		}
		try {
			var parentChannel = null;
			if (config.channelCreateMode) {
				parentChannel = backend.getChannelByID(config.streamerChannelParent);
			}
			var liveStreamerCount = onlineStreamer.length;
			var infoChannelDesc = "[b][size=18][color=#FF0000]L[/color][color=#BF003F]I[/color][color=#7F007F]V[/color][color=#3F00BF]E[/color] Twitch Streamer (" + liveStreamerCount + ")[/size][/b]\r\n\r\n";
			var liveChannelsCheck = [];
			//Sort the names, so that it updates the Content only when something has changed
			onlineStreamerContent.sort(function (a, b) {
				if (a.name < b.name) { return -1; }
				if (a.name > b.name) { return 1; }
				return 0;});
			while (onlineStreamerContent.length > 0) {
				var twitchContent = onlineStreamerContent.pop();
				var twitchName = twitchContent.name;
				var liveClient = twitchContent.tsclient;

				if (config.infoChannelMode) {
					infoChannelDesc += twitchContent.desc.replace("{width}", "160").replace("{height}", "90") + "\r\n\r\n";
				}

				if (config.channelCreateMode) {
					try {
						var liveDescChannel = twitchContent.desc.replace("{width}", "320").replace("{height}", "180");
						if (parentChannel != null) {
							var twitchChannels = backend.getChannelsByName(twitchName);
							var twitchChannel = null;
							twitchChannels.forEach(chnnl => {
								try {
									logToOutput('CheckChannel ' + chnnl.name(), false);
									if (twitchChannel == null && chnnl.parent().id() == parentChannel.id()) {
										twitchChannel = chnnl;
									}
								} catch (error) {
									logToOutput('FindChannelError ' + twitchName + ' : ' + error.message, true);
								}
							});
							var userEligible = true;
							if (config.streamerChannelGroup > 0) {
								userEligible = isInGroup(liveClient, config.streamerChannelGroup);
							}
							if (twitchChannel == null) {
								if (userEligible) {
									var randomPW = makeid(6);
									twitchChannel = backend.createChannel({ name: twitchName, parent: parentChannel.id(), description: liveDescChannel, password: randomPW, semiPermanent: true, topic: liveClient.name() });
									liveClient.chat("Channel created, password is: " + randomPW);
									liveChannelsCheck.push(twitchChannel.id());
								}
							} else {
								if (userEligible) {
									if (twitchChannel.description() != liveDescChannel) {
										twitchChannel.setDescription(liveDescChannel);
									}
									liveChannelsCheck.push(twitchChannel.id());
								}
							}
						}
					} catch (error) {
						logToOutput('ChannelCreateError ' + config.twitchInfoChannel + ' : ' + error.message, true);
					}
				}
			}
			if (config.infoChannelMode) {
				var infoChannelName = "[cspacer]Keine Streamer Online";
				try {
					if (firstRun) {
						infoChannelName = "[cspacer]--INITIALIZING--";
						infoChannelDesc = "[b][size=18][color=#FF0000]L[/color][color=#BF003F]I[/color][color=#7F007F]V[/color][color=#3F00BF]E[/color] Twitch Streamer[/b]\r\n\r\nInitializing...";
					} else {
						if (liveStreamerCount > 0) {
							infoChannelName = "[cspacer]" + liveStreamerCount + " Streamer online [click me]";
						}
					}
					var infoChannel = backend.getChannelByID(config.twitchInfoChannel);
					if (infoChannel != null) {
						if (infoChannel.description() != infoChannelDesc) {
							infoChannel.setName(infoChannelName);
							infoChannel.setDescription(infoChannelDesc);
						}
					}
				} catch (error) {
					logToOutput('InfoChannelError ' + config.twitchInfoChannel + ' : ' + error.message, true);
				}
			}
			if (config.channelCreateMode) {
				if (parentChannel != null) {
					var cChannels = getChannelChildren(parentChannel);
					cChannels.forEach(cChnnl => {
						if (!liveChannelsCheck.includes(cChnnl.id())) {
							if (cChnnl.topic().length > 0 && cChnnl.getClientCount() == 0) {
								cChnnl.delete();
							}
						}
					});
				}
			}
		} catch (error) {
			logToOutput('ChannelStuffError ' + config.twitchInfoChannel + ' : ' + error.message, true);
		}
		onlineStreamer = [];
		checkStreamerCount = 0;
		checkedStreamerCount = 0;
		if (config.mode == 0) {
			logToOutput('Checking Twitch Live Status for ' + tsTwitch.length + ' users', false);
			//check for all users that are configurated
			for (i = 0; i < tsTwitch.length; i++) {
				//usr looks like this:  globalTwitchID63274gs82=:myChannelTV
				var usr = tsTwitch[i];
				//we split with the delimeter
				var tmp = usr.split(':');
				//check if split worked
				if (tmp.length == 2) {
					var tsID = tmp[0];
					logToOutput('TS-ID: ' + tsID, false);
					var twitchID = tmp[1];
					logToOutput('Twitch-ID: ' + twitchID, false);
					//we search for the client and check if he is online
					var client = backend.getClientByUniqueID(tsID);
					if (client != undefined && client != null) {
						//client is found and is online
						logToOutput(client.name() + ' is online in Teamspeak', false);
						checkStreamerCount += 1;
						//and we check for the client's live status
						checkLiveStatus(client, twitchID);
					} else {
						logToOutput('Client not found', false);
					}
				}
			}
		} else {
			//check for all online users
			var onlineClients = backend.getClients();
			logToOutput('Checking Twitch Live Status for ' + onlineClients.length + ' users', false);
			var checkStreamers = [];
			onlineClients.forEach(function (client) {
				//get the description of the client
				var desc = client.description();
				//now we search and extract the twitch name from the description
				var twitchNamePos = desc.search(config.twitchNameHint);
				if (twitchNamePos != -1) {
					twitchNamePos = twitchNamePos + config.twitchNameHint.length;
					var twitchNameAndRest = desc.substr(twitchNamePos);
					var twitchNameEnd = twitchNameAndRest.search(' ');
					if (twitchNameEnd == -1) {
						twitchNameEnd = twitchNameAndRest.search('\n');
					}
					//MAGIC NUMBEEEERRRRS
					if (twitchNameEnd == -1) {
						twitchNameEnd = twitchNameAndRest.length;
					}
					if (twitchNameEnd != -1) {
						//Okay we have found the twitch name start and end position and can now extract it from the substring
						var twitchName = twitchNameAndRest.substr(0, twitchNameEnd);
						logToOutput('Found the twitch Name: ' + twitchName, false);
						//and check for the client's live status
						checkStreamers.push({ "cl": client, "tn": twitchName });
					} else {
						logToOutput('Could not find end of twitch Name: ' + twitchNameAndRest, true);
					}
				} else {
					//logToOutput(client.name() + ' has no twitch name in description', false);
					if (isInGroup(client, config.twitchLiveGroup)) {
						logToOutput('Live group is being removed...', false);
						client.removeFromServerGroup(config.twitchLiveGroup);
					}
				}
			});
			checkStreamerCount = checkStreamers.length;
			for (let i = 0; i < checkStreamerCount; i++) {
				const cs = checkStreamers[i];
				checkLiveStatus(cs.cl, cs.tn);
			}
		}
		if (firstRun) {
			firstRun = false;
		}
	}, config.interval * 1000);
});