/**
 * Copyright (c) 2019 Oracle and/or its affiliates. All rights reserved.
 * Licensed under the Universal Permissive License v 1.0 as shown at http://oss.oracle.com/licenses/upl.
 */
/* global console, __dirname, process, console */
/* jshint esversion: 6 */

var serverUtils = require('../test/server/serverUtils.js'),
	serverRest = require('../test/server/serverRest.js'),
	sitesRest = require('../test/server/sitesRest.js'),
	os = require('os'),
	readline = require('readline'),
	request = require('request'),
	dir = require('node-dir'),
	fs = require('fs'),
	fse = require('fs-extra'),
	path = require('path'),
	sprintf = require('sprintf-js').sprintf;

var projectDir,
	documentsSrcDir,
	serversSrcDir;

/**
 * Verify the source structure before proceed the command
 * @param {*} done 
 */
var verifyRun = function (argv) {
	projectDir = argv.projectDir;

	var srcfolder = serverUtils.getSourceFolder(projectDir);

	documentsSrcDir = path.join(srcfolder, 'documents');
	serversSrcDir = path.join(srcfolder, 'servers');

	return true;
};

module.exports.createFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var name = argv.name;
	var folderPath = name.split('/');

	_createFolder(server, 'self', folderPath, true).then(function (result) {
			done(true);
		})
		.catch((error) => {
			done();
		});
};

var _createFolder = function (server, rootParentId, folderPath, showMessage) {
	return new Promise(function (resolve, reject) {
		var folderPromises = [],
			parentGUID;
		folderPath.forEach(function (foldername) {
			if (foldername) {
				folderPromises.push(function (parentID) {
					return serverRest.findOrCreateFolder({
						server: server,
						parentID: parentID,
						foldername: foldername
					});
				});
			}
		});

		// get the folders in sequence
		var doFindFolder = folderPromises.reduce(function (previousPromise, nextPromise) {
				return previousPromise.then(function (folderDetails) {
					// store the parent
					if (folderDetails && folderDetails.id) {
						if (folderDetails.__created) {
							if (showMessage) {
								console.log(' - create folder ' + folderDetails.name + ' (Id: ' + folderDetails.id + ')');
							}
						} else if (folderDetails.id !== 'self') {
							if (showMessage) {
								console.log(' - find folder ' + folderDetails.name + ' (Id: ' + folderDetails.id + ')');
							}
						}
						parentGUID = folderDetails.id;

						// wait for the previous promise to complete and then return a new promise for the next 
						return nextPromise(parentGUID);
					}
				});
			},
			// Start with a previousPromise value that is a resolved promise passing in the home folder id as the parentID
			Promise.resolve({
				id: rootParentId
			}));

		doFindFolder.then(function (newFolder) {
			if (newFolder && newFolder.id) {
				if (newFolder.__created) {
					if (showMessage) {
						console.log(' - create folder ' + newFolder.name + ' (Id: ' + newFolder.id + ')');
					}
				} else if (newFolder.id !== 'self') {
					if (showMessage) {
						console.log(' - find folder ' + newFolder.name + ' (Id: ' + newFolder.id + ')');
					}
				}
			}
			resolve(newFolder);
		});
	});
};

module.exports.uploadFile = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var filePath = argv.file;
	if (!path.isAbsolute(filePath)) {
		filePath = path.join(projectDir, filePath);
	}
	filePath = path.resolve(filePath);
	var fileName = filePath.substring(filePath.lastIndexOf('/') + 1);

	if (!fs.existsSync(filePath)) {
		console.log('ERROR: file ' + filePath + ' does not exist');
		done();
		return;
	}
	if (fs.statSync(filePath).isDirectory()) {
		console.log('ERROR: ' + filePath + ' is not a file');
		done();
		return;
	}

	var inputPath = argv.folder === '/' ? '' : serverUtils.trimString(argv.folder, '/');
	var resourceFolder = false;
	var resourceName;
	var resourceType;
	var resourceLabel;
	if (inputPath && (inputPath.indexOf('site:') === 0 || inputPath.indexOf('theme:') === 0 || inputPath.indexOf('component:') === 0)) {
		resourceFolder = true;
		if (inputPath.indexOf('site:') === 0) {
			inputPath = inputPath.substring(5);
			resourceType = 'site';
			resourceLabel = 'Sites';
		} else if (inputPath.indexOf('theme:') === 0) {
			inputPath = inputPath.substring(6);
			resourceType = 'theme';
			resourceLabel = 'Themes';
		} else {
			inputPath = inputPath.substring(10);
			resourceType = 'component';
			resourceLabel = 'Components';
		}
		if (inputPath.indexOf('/') > 0) {
			resourceName = inputPath.substring(0, inputPath.indexOf('/'));
			inputPath = inputPath.substring(inputPath.indexOf('/') + 1);
		} else {
			resourceName = inputPath;
			inputPath = '';
		}
	}
	var folderPath = inputPath ? inputPath.split('/') : [];
	console.log(' - target folder: ' + (resourceFolder ? (resourceLabel + ' > ' + resourceName) : 'Documents') + ' > ' + folderPath.join(' > '));

	var request = serverUtils.getRequest();
	var loginPromises = [];

	if (resourceFolder) {
		loginPromises.push(serverUtils.loginToServer(server, request));
	}

	Promise.all(loginPromises).then(function (results) {
		if (resourceFolder && (!results || results.length === 0 || !results[0].status)) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		var resourcePromises = [];
		if (resourceFolder) {
			if (resourceType === 'site') {
				resourcePromises.push(server.useRest ? sitesRest.getSite({
					server: server,
					name: resourceName
				}) : serverUtils.getSiteFolderAfterLogin(server, resourceName));
			} else if (resourceType === 'theme') {
				resourcePromises.push(server.useRest ? sitesRest.getTheme({
					server: server,
					name: resourceName
				}) : _getThemeGUID(request, server, resourceName));
			} else {
				resourcePromises.push(server.useRest ? sitesRest.getComponent({
					server: server,
					name: resourceName
				}) : _getComponentGUID(request, server, resourceName));
			}
		}

		Promise.all(resourcePromises).then(function (results) {
				var rootParentId = 'self';
				if (resourceFolder) {
					var resourceGUID;
					if (results.length > 0 && results[0]) {
						resourceGUID = results[0].id;
					}

					if (!resourceGUID) {
						console.log('ERROR: invalid ' + resourceType + ' ' + resourceName);
						return Promise.reject();
					}
					rootParentId = resourceGUID;
				}

				return _findFolder(server, rootParentId, folderPath);
			})
			.then(function (result) {
				if (folderPath.length > 0 && !result) {
					return Promise.reject();
				}

				if (resourceFolder && !result.id || !resourceFolder && result.id !== 'self' && (!result.type || result.type !== 'folder')) {
					console.log('ERROR: invalid folder ' + argv.folder);
					return Promise.reject();
				}

				return serverRest.createFile({
					server: server,
					parentID: result.id,
					filename: fileName,
					contents: fs.readFileSync(filePath)
				});
			})
			.then(function (result) {
				if (result) {
					console.log(' - file ' + fileName + ' uploaded to ' +
						(argv.folder ? ('folder ' + argv.folder) : 'Home folder') +
						' (Id: ' + result.id + ' version:' + result.version + ')');
					done(true);
				} else {
					done();
				}
			})
			.catch((error) => {
				done();
			});
	}); // login
};

var _findFolder = function (server, rootParentId, folderPath, showError) {
	return new Promise(function (resolve, reject) {
		var folderPromises = [],
			parentGUID;
		folderPath.forEach(function (foldername) {
			if (foldername) {
				folderPromises.push(function (parentID) {
					return serverRest.findFile({
						server: server,
						parentID: parentID,
						filename: foldername,
						itemtype: 'folder',
						showError: showError
					});
				});
			}
		});

		// get the folders in sequence
		var doFindFolder = folderPromises.reduce(function (previousPromise, nextPromise) {
				return previousPromise.then(function (folderDetails) {
					// store the parent
					if (folderDetails && folderDetails.id) {
						if (folderDetails.id !== rootParentId) {
							console.log(' - find ' + folderDetails.type + ' ' + folderDetails.name + ' (Id: ' + folderDetails.id + ')');
						}
						parentGUID = folderDetails.id;

						// wait for the previous promise to complete and then return a new promise for the next 
						return nextPromise(parentGUID);
					}
				});
			},
			// Start with a previousPromise value that is a resolved promise passing in the home folder id as the parentID
			Promise.resolve({
				id: rootParentId
			}));

		doFindFolder.then(function (parentFolder) {
			if (parentFolder && parentFolder.id) {
				if (parentFolder.id !== rootParentId) {
					console.log(' - find ' + parentFolder.type + ' ' + parentFolder.name + ' (Id: ' + parentFolder.id + ')');
				}
			}
			resolve(parentFolder);
		})
	});
};


module.exports.downloadFile = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var filePath = argv.file;
	var fileName = filePath;
	if (fileName.indexOf('/') > 0) {
		fileName = fileName.substring(fileName.lastIndexOf('/') + 1);
	}

	var folderPathStr = filePath.indexOf('/') >= 0 ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
	var resourceFolder = false;
	var resourceName;
	var resourceType;
	var resourceLabel;
	if (folderPathStr && (folderPathStr.indexOf('site:') === 0 || folderPathStr.indexOf('theme:') === 0 || folderPathStr.indexOf('component:') === 0)) {
		resourceFolder = true;
		if (folderPathStr.indexOf('site:') === 0) {
			folderPathStr = folderPathStr.substring(5);
			resourceType = 'site';
			resourceLabel = 'Sites';
		} else if (folderPathStr.indexOf('theme:') === 0) {
			folderPathStr = folderPathStr.substring(6);
			resourceType = 'theme';
			resourceLabel = 'Themes';
		} else {
			folderPathStr = folderPathStr.substring(10);
			resourceType = 'component';
			resourceLabel = 'Components';
		}
		if (folderPathStr.indexOf('/') > 0) {
			resourceName = folderPathStr.substring(0, folderPathStr.indexOf('/'));
			folderPathStr = folderPathStr.substring(folderPathStr.indexOf('/') + 1);
		} else {
			resourceName = folderPathStr;
			folderPathStr = '';
		}
	}
	// console.log('argv.file=' + argv.file + ' folderPathStr=' + folderPathStr + ' resourceName=' + resourceName);

	var folderPath = folderPathStr.split('/');
	var folderId;

	if (!fs.existsSync(documentsSrcDir)) {
		fse.mkdirSync(documentsSrcDir);
	}
	var targetPath;
	if (argv.folder) {
		targetPath = argv.folder;
		if (!path.isAbsolute(targetPath)) {
			targetPath = path.join(projectDir, targetPath);
		}
		targetPath = path.resolve(targetPath);
		if (!fs.existsSync(targetPath)) {
			console.log('ERROR: folder ' + targetPath + ' does not exist');
			done();
			return;
		}
		if (!fs.statSync(targetPath).isDirectory()) {
			console.log('ERROR: ' + targetPath + ' is not a folder');
			done();
			return;
		}
	}

	var request = serverUtils.getRequest();
	var loginPromises = [];

	if (resourceFolder) {
		loginPromises.push(serverUtils.loginToServer(server, request));
	}

	Promise.all(loginPromises).then(function (results) {
		if (resourceFolder && (!results || results.length === 0 || !results[0].status)) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		var resourcePromises = [];
		if (resourceFolder) {
			if (resourceType === 'site') {
				resourcePromises.push(server.useRest ? sitesRest.getSite({
					server: server,
					name: resourceName
				}) : serverUtils.getSiteFolderAfterLogin(server, resourceName));
			} else if (resourceType === 'theme') {
				resourcePromises.push(server.useRest ? sitesRest.getTheme({
					server: server,
					name: resourceName
				}) : _getThemeGUID(request, server, resourceName));
			} else {
				resourcePromises.push(server.useRest ? sitesRest.getComponent({
					server: server,
					name: resourceName
				}) : _getComponentGUID(request, server, resourceName));
			}
		}

		Promise.all(resourcePromises).then(function (results) {
				var rootParentId = 'self';
				if (resourceFolder) {
					var resourceGUID;
					if (results.length > 0 && results[0]) {
						resourceGUID = results[0].id;
					}

					if (!resourceGUID) {
						console.log('ERROR: invalid ' + resourceType + ' ' + resourceName);
						return Promise.reject();
					}
					rootParentId = resourceGUID;
				}
				return _findFolder(server, rootParentId, folderPath);
			}).then(function (result) {
				if (folderPath.length > 0 && !result) {
					return Promise.reject();
				}

				if (resourceFolder && !result.id || !resourceFolder && result.id !== 'self' && (!result.type || result.type !== 'folder')) {
					console.log('ERROR: invalid folder ' + folderPathStr);
					return Promise.reject();
				}
				folderId = result.id;

				return serverRest.findFile({
					server: server,
					parentID: result.id,
					filename: fileName,
					itemtype: 'file'
				});
			})
			.then(function (result) {
				if (!result || !result.id) {
					return Promise.reject();
				}

				// console.log('folderId: ' + folderId + ' fileName: ' + fileName + ' fileId: ' + result.id);
				return _readFile(server, result.id, fileName, folderPath);
			})
			.then(function (result) {
				if (!result || !result.data) {
					console.log('ERROR: failed to get file from server');
					return Promise.reject();
				}

				if (!argv.folder) {
					targetPath = documentsSrcDir;
					if (resourceFolder) {
						targetPath = path.join(documentsSrcDir, resourceName);
						if (!fs.existsSync(targetPath)) {
							fse.mkdirSync(targetPath);
						}
					}
					for (var i = 0; i < folderPath.length; i++) {
						targetPath = path.join(targetPath, folderPath[i]);
						if (!fs.existsSync(targetPath)) {
							fse.mkdirSync(targetPath);
						}
					}
				}

				var targetFile = path.join(targetPath, fileName);
				var fileContent = result.data;
				fs.writeFileSync(targetFile, fileContent);

				console.log(' - save file ' + targetFile);

				done(true);
			})
			.catch((error) => {
				done();
			});
	}); // login 
};


module.exports.shareFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var name = argv.name;
	var folderPath = name.split('/');
	var folderId;

	var userNames = argv.users.split(',');
	var role = argv.role;

	var users = [];

	_findFolder(server, 'self', folderPath).then(function (result) {
			if (folderPath.length > 0 && !result) {
				return Promise.reject();
			}

			if (result.id !== 'self' && (!result.type || result.type !== 'folder')) {
				console.log('ERROR: invalid folder ' + argv.name);
				return Promise.reject();
			}
			folderId = result.id;

			var usersPromises = [];
			for (var i = 0; i < userNames.length; i++) {
				usersPromises.push(serverRest.getUser({
					server: server,
					name: userNames[i]
				}));
			}

			return Promise.all(usersPromises);
		})
		.then(function (results) {
			var allUsers = [];
			for (var i = 0; i < results.length; i++) {
				if (results[i].items) {
					allUsers = allUsers.concat(results[i].items);
				}
			}
			// verify users
			for (var k = 0; k < userNames.length; k++) {
				var found = false;
				for (var i = 0; i < allUsers.length; i++) {
					if (allUsers[i].loginName.toLowerCase() === userNames[k].toLowerCase()) {
						users.push(allUsers[i]);
						found = true;
						break;
					}
					if (found) {
						break;
					}
				}
				if (!found) {
					console.log('ERROR: user ' + userNames[k] + ' does not exist');
					return Promise.reject();
				}
			}

			return serverRest.getFolderUsers({
				server: server,
				id: folderId
			});
		})
		.then(function (result) {
			var existingMembers = result.data || [];

			var sharePromises = [];
			for (var i = 0; i < users.length; i++) {
				var newMember = true;
				for (var j = 0; j < existingMembers.length; j++) {
					if (existingMembers[j].id === users[i].id) {
						newMember = false;
						break;
					}
				}
				// console.log(' - user: ' + users[i].loginName + ' new grant: ' + newMember);
				sharePromises.push(serverRest.shareFolder({
					server: server,
					id: folderId,
					userId: users[i].id,
					role: role,
					create: newMember
				}));
			}
			return Promise.all(sharePromises);
		})
		.then(function (results) {
			var shared = false;
			for (var i = 0; i < results.length; i++) {
				if (results[i].errorCode === '0') {
					shared = true;
					console.log(' - user ' + results[i].user.loginName + ' granted "' +
						results[i].role + '" on folder ' + name);
				} else {
					console.log('ERROR: ' + results[i].title);
				}
			}
			done(shared);
		})
		.catch((error) => {
			done();
		});
};


module.exports.unshareFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var name = argv.name;
	var folderPath = name.split('/');
	var folderId;

	var userNames = argv.users.split(',');
	var users = [];

	_findFolder(server, 'self', folderPath).then(function (result) {
			if (folderPath.length > 0 && !result) {
				return Promise.reject();
			}

			if (result.id !== 'self' && (!result.type || result.type !== 'folder')) {
				console.log('ERROR: invalid folder ' + argv.name);
				return Promise.reject();
			}
			folderId = result.id;

			var usersPromises = [];
			for (var i = 0; i < userNames.length; i++) {
				usersPromises.push(serverRest.getUser({
					server: server,
					name: userNames[i]
				}));
			}

			return Promise.all(usersPromises);
		})
		.then(function (results) {
			var allUsers = [];
			for (var i = 0; i < results.length; i++) {
				if (results[i].items) {
					allUsers = allUsers.concat(results[i].items);
				}
			}
			// verify users
			for (var k = 0; k < userNames.length; k++) {
				var found = false;
				for (var i = 0; i < allUsers.length; i++) {
					if (allUsers[i].loginName.toLowerCase() === userNames[k].toLowerCase()) {
						users.push(allUsers[i]);
						found = true;
						break;
					}
					if (found) {
						break;
					}
				}
				if (!found) {
					console.log('ERROR: user ' + userNames[k] + ' does not exist');
					return Promise.reject();
				}
			}

			return serverRest.getFolderUsers({
				server: server,
				id: folderId
			});
		})
		.then(function (result) {
			var existingMembers = result.data || [];
			var revokePromises = [];
			for (var i = 0; i < users.length; i++) {
				var existingUser = false;
				for (var j = 0; j < existingMembers.length; j++) {
					if (users[i].id === existingMembers[j].id) {
						existingUser = true;
						break;
					}
				}

				if (existingUser) {
					revokePromises.push(serverRest.unshareFolder({
						server: server,
						id: folderId,
						userId: users[i].id
					}));
				} else {
					console.log(' - user ' + users[i].loginName + ' has no access to the folder');
				}
			}

			return Promise.all(revokePromises);
		})
		.then(function (results) {
			var unshared = false;
			for (var i = 0; i < results.length; i++) {
				if (results[i].errorCode === '0') {
					unshared = true;
					console.log(' - user ' + results[i].user.loginName + '\'s access to the folder removed');
				} else {
					console.log('ERROR: ' + results[i].title);
				}
			}
			done(unshared);
		})
		.catch((error) => {
			done();
		});
};


// Read file from server
var _readFile = function (server, fFileGUID, fileName, folderPath) {
	return new Promise(function (resolve, reject) {

		var auth = {
			user: server.username,
			password: server.password
		};

		url = server.url + '/documents/api/1.2/files/' + fFileGUID + '/data/';

		var options = {
			url: url,
			auth: auth,
			encoding: null
		};
		request(options, function (error, response, body) {
			if (error) {
				console.log('ERROR: failed to get file ' + fileName);
				console.log(error);
				resolve();
			}
			if (response && response.statusCode === 200) {
				resolve({
					id: fFileGUID,
					name: fileName,
					folderPath: folderPath,
					data: body
				});
			} else {
				console.log('ERROR: failed to get file ' + fileName + ' : ' + (response ? (response.statusMessage || response.statusCode) : ''));
				resolve();
			}

		});
	});
};

// All files to download from server
var _files = [];

module.exports.downloadFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var targetPath;
	if (argv.folder) {
		targetPath = argv.folder;
		if (!path.isAbsolute(targetPath)) {
			targetPath = path.join(projectDir, targetPath);
		}
		targetPath = path.resolve(targetPath);
		if (!fs.existsSync(targetPath)) {
			console.log('ERROR: folder ' + targetPath + ' does not exist');
			done();
			return;
		}
		if (!fs.statSync(targetPath).isDirectory()) {
			console.log('ERROR: ' + targetPath + ' is not a folder');
			done();
			return;
		}
	}

	var inputPath = argv.path === '/' ? '' : serverUtils.trimString(argv.path, '/');
	var resourceFolder = false;
	var resourceName;
	var resourceType;
	var resourceLabel;
	if (inputPath && (inputPath.indexOf('site:') === 0 || inputPath.indexOf('theme:') === 0 || inputPath.indexOf('component:') === 0)) {
		resourceFolder = true;
		if (inputPath.indexOf('site:') === 0) {
			inputPath = inputPath.substring(5);
			resourceType = 'site';
			resourceLabel = 'Sites';
		} else if (inputPath.indexOf('theme:') === 0) {
			inputPath = inputPath.substring(6);
			resourceType = 'theme';
			resourceLabel = 'Themes';
		} else {
			inputPath = inputPath.substring(10);
			resourceType = 'component';
			resourceLabel = 'Components';
		}
		if (inputPath.indexOf('/') > 0) {
			resourceName = inputPath.substring(0, inputPath.indexOf('/'));
			inputPath = inputPath.substring(inputPath.indexOf('/') + 1);
		} else {
			resourceName = inputPath;
			inputPath = '';
		}
	}

	var folderPath = argv.path === '/' || !inputPath ? [] : inputPath.split('/');
	// console.log('argv.path=' + argv.path + ' inputPath=' + inputPath + ' folderPath=' + folderPath);

	var folderId;

	_files = [];

	var request = serverUtils.getRequest();
	var loginPromises = [];

	if (resourceFolder) {
		loginPromises.push(serverUtils.loginToServer(server, request));
	}

	Promise.all(loginPromises).then(function (results) {
		if (resourceFolder && (!results || results.length === 0 || !results[0].status)) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		var resourcePromises = [];
		if (resourceFolder) {
			if (resourceType === 'site') {
				resourcePromises.push(server.useRest ? sitesRest.getSite({
					server: server,
					name: resourceName
				}) : serverUtils.getSiteFolderAfterLogin(server, resourceName));
			} else if (resourceType === 'theme') {
				resourcePromises.push(server.useRest ? sitesRest.getTheme({
					server: server,
					name: resourceName
				}) : _getThemeGUID(request, server, resourceName));
			} else {
				resourcePromises.push(server.useRest ? sitesRest.getComponent({
					server: server,
					name: resourceName
				}) : _getComponentGUID(request, server, resourceName));
			}
		}

		Promise.all(resourcePromises).then(function (results) {
				var rootParentId = 'self';
				if (resourceFolder) {
					var resourceGUID;
					if (results.length > 0 && results[0]) {
						resourceGUID = results[0].id;
					}

					if (!resourceGUID) {
						console.log('ERROR: invalid ' + resourceType + ' ' + resourceName);
						return Promise.reject();
					}
					rootParentId = resourceGUID;
				}

				return _findFolder(server, rootParentId, folderPath);
			})
			.then(function (result) {
				if (folderPath.length > 0 && !result) {
					return Promise.reject();
				}

				if (resourceFolder && !result.id || !resourceFolder && result.id !== 'self' && (!result.type || result.type !== 'folder')) {
					console.log('ERROR: invalid folder ' + argv.path);
					return Promise.reject();
				}
				folderId = result.id;

				return _downloadFolder(server, folderId, inputPath);
			})
			.then(function (result) {

				return _readAllFiles(server, _files);
			})
			.then(function (results) {
				if (!argv.folder) {
					targetPath = documentsSrcDir;
					if (resourceFolder) {
						targetPath = path.join(documentsSrcDir, resourceName);
						if (!fs.existsSync(targetPath)) {
							fse.mkdirSync(targetPath);
						}
					}
					for (var i = 0; i < folderPath.length; i++) {
						targetPath = path.join(targetPath, folderPath[i]);
						if (!fs.existsSync(targetPath)) {
							fse.mkdirSync(targetPath);
						}
					}
				}

				for (var i = 0; i < results.length; i++) {
					var file = results[i];
					var folderPathStr = serverUtils.trimString(file.folderPath, '/');

					// do not create folder hierarchy on the server when save to different local folder
					if (inputPath && folderPathStr.startsWith(inputPath)) {
						folderPathStr = folderPathStr.substring(inputPath.length);
					}

					var fileFolderPath = folderPathStr ? folderPathStr.split('/') : [];
					var targetFile = targetPath;
					for (var j = 0; j < fileFolderPath.length; j++) {
						var targetFile = path.join(targetFile, fileFolderPath[j]);
						if (!fs.existsSync(targetFile)) {
							fse.mkdirSync(targetFile);
						}
					}
					targetFile = path.join(targetFile, file.name);

					fs.writeFileSync(targetFile, file.data);
					console.log(' - save file ' + targetFile);
				}

				done(true);
			})
			.catch((error) => {
				done();
			});
	}); // login
};

var _readAllFiles = function (server, files) {
	return new Promise(function (resolve, reject) {
		var total = files.length;
		console.log(' - total number of files: ' + total);
		var groups = [];
		var limit = 16;
		var start, end;
		for (var i = 0; i < total / limit; i++) {
			start = i * limit;
			end = start + limit - 1;
			if (end >= total) {
				end = total - 1;
			}
			groups.push({
				start: start,
				end: end
			});
		}
		if (end < total - 1) {
			groups.push({
				start: end + 1,
				end: total - 1
			});
		}
		// console.log(' - total number of groups: ' + groups.length);

		var fileData = [];
		var count = [];

		var doReadFile = groups.reduce(function (filePromise, param) {
				return filePromise.then(function (result) {
					var filePromises = [];
					for (var i = param.start; i <= param.end; i++) {
						filePromises.push(_readFile(server, files[i].id, files[i].name, files[i].folderPath));
					}

					count.push('.');
					process.stdout.write(' - downloading files ' + count.join(''));
					readline.cursorTo(process.stdout, 0);
					return Promise.all(filePromises).then(function (results) {
						fileData = fileData.concat(results);
					});

				});
			},
			// Start with a previousPromise value that is a resolved promise 
			Promise.resolve({}));

		doReadFile.then(function (result) {
			process.stdout.write(os.EOL);
			// console.log(' - total number of downloaded files: ' + fileData.length);
			resolve(fileData);
		});

	});
};

var _downloadFolder = function (server, parentId, parentPath) {
	// console.log(' - folder: id=' + parentId + ' path=' + parentPath);
	return new Promise(function (resolve, reject) {
		serverRest.getChildItems({
				server: server,
				parentID: parentId,
				limit: 9999
			})
			.then(function (result) {
				if (!result) {
					resolve();
				}

				var items = result && result.items || [];
				var subfolderPromises = [];
				for (var i = 0; i < items.length; i++) {
					if (items[i].type === 'file') {
						// console.log(' - file: id=' + items[i].id + ' path=' + parentPath + '/' + items[i].name);
						_files.push({
							id: items[i].id,
							name: items[i].name,
							folderPath: parentPath
						});

					} else {
						subfolderPromises.push(_downloadFolder(server, items[i].id, parentPath + '/' + items[i].name));
					}
				}
				return Promise.all(subfolderPromises);
			})
			.then(function (results) {
				resolve(results);
			});
	});
};

module.exports.uploadFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var srcPath = argv.path;
	var contentOnly = serverUtils.endsWith(srcPath, path.sep);

	if (!path.isAbsolute(srcPath)) {
		srcPath = path.join(projectDir, srcPath);
	}
	srcPath = path.resolve(srcPath);

	if (!fs.existsSync(srcPath)) {
		console.log('ERROR: file ' + srcPath + ' does not exist');
		done();
		return;
	}
	if (!fs.statSync(srcPath).isDirectory()) {
		console.log('ERROR: ' + srcPath + ' is not a folder');
		done();
		return;
	}

	// remove drive on windows
	if (srcPath.indexOf(path.sep) > 0) {
		srcPath = srcPath.substring(srcPath.indexOf(path.sep));
	}

	var folderName = contentOnly ? '' : srcPath.substring(srcPath.lastIndexOf(path.sep) + 1);
	// console.log(' - path=' + argv.path + ' srcPath=' + srcPath + ' contentOnly=' + contentOnly + ' folderName=' + folderName);

	var inputPath = argv.folder === '/' ? '' : serverUtils.trimString(argv.folder, '/');
	var resourceFolder = false;
	var resourceName;
	var resourceType;
	var resourceLabel;
	if (inputPath && (inputPath.indexOf('site:') === 0 || inputPath.indexOf('theme:') === 0 || inputPath.indexOf('component:') === 0)) {
		resourceFolder = true;
		if (inputPath.indexOf('site:') === 0) {
			inputPath = inputPath.substring(5);
			resourceType = 'site';
			resourceLabel = 'Sites';
		} else if (inputPath.indexOf('theme:') === 0) {
			inputPath = inputPath.substring(6);
			resourceType = 'theme';
			resourceLabel = 'Themes';
		} else {
			inputPath = inputPath.substring(10);
			resourceType = 'component';
			resourceLabel = 'Components';
		}
		if (inputPath.indexOf('/') > 0) {
			resourceName = inputPath.substring(0, inputPath.indexOf('/'));
			inputPath = inputPath.substring(inputPath.indexOf('/') + 1);
		} else {
			resourceName = inputPath;
			inputPath = '';
		}
	}
	// console.log('argv.folder=' + argv.folder + ' inputPath=' + inputPath + ' siteName=' + siteName);
	var folderPath = !argv.folder || argv.folder === '/' || !inputPath ? [] : inputPath.split(path.sep);
	if (folderName) {
		folderPath.push(folderName);
	}
	console.log(' - target folder: ' + (resourceFolder ? (resourceLabel + ' > ' + resourceName) : 'Documents') + ' > ' + folderPath.join(' > '));

	// get all files to upload
	var folderContent = [];
	dir.files(srcPath, function (err, files) {
		if (err) {
			console.log(err);
			done();
		} else {
			// group files under the same folder
			for (var i = 0; i < files.length; i++) {
				var src = files[i];
				src = src.substring(srcPath.length + 1);
				var fileFolder = src.indexOf(path.sep) > 0 ? src.substring(0, src.lastIndexOf(path.sep)) : '';

				var found = false;
				for (var j = 0; j < folderContent.length; j++) {
					if (folderContent[j].fileFolder === fileFolder) {
						found = true;
						folderContent[j].files.push(files[i]);
						break;
					}
				}
				if (!found) {
					folderContent.push({
						fileFolder: fileFolder,
						files: [files[i]]
					});
				}
			}
			// console.log(folderContent);

			var request = serverUtils.getRequest();
			var loginPromises = [];

			if (resourceFolder) {
				loginPromises.push(serverUtils.loginToServer(server, request));
			}

			Promise.all(loginPromises).then(function (results) {
				if (resourceFolder && (!results || results.length === 0 || !results[0].status)) {
					console.log(' - failed to connect to the server');
					done();
					return;
				}

				var resourcePromises = [];
				if (resourceFolder) {
					if (resourceType === 'site') {
						resourcePromises.push(server.useRest ? sitesRest.getSite({
							server: server,
							name: resourceName
						}) : serverUtils.getSiteFolderAfterLogin(server, resourceName));
					} else if (resourceType === 'theme') {
						resourcePromises.push(server.useRest ? sitesRest.getTheme({
							server: server,
							name: resourceName
						}) : _getThemeGUID(request, server, resourceName));
					} else {
						resourcePromises.push(server.useRest ? sitesRest.getComponent({
							server: server,
							name: resourceName
						}) : _getComponentGUID(request, server, resourceName));
					}
				}

				Promise.all(resourcePromises).then(function (results) {
						var rootParentId = 'self';
						if (resourceFolder) {
							var resourceGUID;
							if (results.length > 0 && results[0]) {
								resourceGUID = results[0].id;
							}

							if (!resourceGUID) {
								console.log('ERROR: invalid ' + resourceType + ' ' + resourceName);
								return Promise.reject();
							}
							rootParentId = resourceGUID;
						}
						return _createFolderUploadFiles(server, rootParentId, folderPath, folderContent);
					})
					.then(function (result) {
						done(true);
					})
					.catch((error) => {
						done();
					});
			}); // login
		}
	});
};

var _createFolderUploadFiles = function (server, rootParentId, folderPath, folderContent) {
	return new Promise(function (resolve, reject) {
		format = '   %-48s  %-7s  %-s';
		var doCreateFolders = folderContent.reduce(function (createPromise, param) {
				return createPromise.then(function (result) {
					var folders = folderPath;
					if (param.fileFolder) {
						folders = folders.concat(param.fileFolder.split(path.sep));
					}

					return _createFolder(server, rootParentId, folders, false).then(function (parentFolder) {

						if (parentFolder) {
							var filePromises = [];
							for (var i = 0; i < param.files.length; i++) {
								var filePath = param.files[i];
								var fileName = filePath.substring(filePath.lastIndexOf(path.sep) + 1);
								filePromises.push(serverRest.createFile({
									server: server,
									parentID: parentFolder.id,
									filename: fileName,
									contents: fs.readFileSync(filePath)
								}));
							}

							return Promise.all(filePromises).then(function (results) {
								var folderStr = folders.length > 0 ? folders.join('/') : 'Home folder';
								for (var i = 0; i < results.length; i++) {
									var file = results[i];
									if (file) {
										console.log(sprintf(format, file.name, file.version, folderStr));
									}
								}
							});
						}
					});
				});
			},
			// Start with a previousPromise value that is a resolved promise 
			Promise.resolve({}));
		console.log(' - folder uploaded:');
		console.log(sprintf(format, 'File', 'Version', 'Folder'));
		doCreateFolders.then(function (result) {
			resolve();
		});
	});
};

var _getThemeGUID = function (request, server, themeName) {
	return new Promise(function (resolve, reject) {
		var params = 'doBrowseStarterThemes=1';
		serverUtils.browseThemesOnServer(request, server, params).then(function (result) {
			var themes = result.data || [];
			var themeGuid;
			for (var i = 0; i < themes.length; i++) {
				if (themes[i].fFolderName.toLowerCase() === themeName.toLowerCase()) {
					themeGuid = themes[i].fFolderGUID;
					break;
				}
			}

			if (themeGuid) {
				resolve({
					id: themeGuid
				});
			} else {
				resolve({
					err: 'err'
				});
			}
		});
	});
};

var _getComponentGUID = function (request, server, compName) {
	return new Promise(function (resolve, reject) {
		serverUtils.browseComponentsOnServer(request, server).then(function (result) {
			var comps = result.data || [];
			var compGuid;
			for (var i = 0; i < comps.length; i++) {
				if (comps[i].fFolderName.toLowerCase() === compName.toLowerCase()) {
					compGuid = comps[i].fFolderGUID;
					break;
				}
			}

			if (compGuid) {
				resolve({
					id: compGuid
				});
			} else {
				resolve({
					err: 'err'
				});
			}
		});
	});
};

module.exports.deleteFolder = function (argv, done) {
	'use strict';

	if (!verifyRun(argv)) {
		done();
		return;
	}

	var serverName = argv.server;
	var server = serverUtils.verifyServer(serverName, projectDir);
	if (!server || !server.valid) {
		done();
		return;
	}
	console.log(' - server: ' + server.url);

	var inputPath = argv.path === '/' ? '' : serverUtils.trimString(argv.path, '/');
	var resourceFolder = false;
	var resourceName;
	var resourceType;
	var resourceLabel;
	if (inputPath && (inputPath.indexOf('site:') === 0 || inputPath.indexOf('theme:') === 0 || inputPath.indexOf('component:') === 0)) {
		resourceFolder = true;
		if (inputPath.indexOf('site:') === 0) {
			inputPath = inputPath.substring(5);
			resourceType = 'site';
			resourceLabel = 'Sites';
		} else if (inputPath.indexOf('theme:') === 0) {
			inputPath = inputPath.substring(6);
			resourceType = 'theme';
			resourceLabel = 'Themes';
		} else {
			inputPath = inputPath.substring(10);
			resourceType = 'component';
			resourceLabel = 'Components';
		}
		if (inputPath.indexOf('/') > 0) {
			resourceName = inputPath.substring(0, inputPath.indexOf('/'));
			inputPath = inputPath.substring(inputPath.indexOf('/') + 1);
		} else {
			resourceName = inputPath;
			inputPath = '';
		}
	}

	var folderPath = argv.path === '/' || !inputPath ? [] : inputPath.split('/');
	// console.log('argv.path=' + argv.path + ' inputPath=' + inputPath + ' folderPath=' + folderPath);

	if (folderPath.length === 0) {
		console.log('ERROR: no folder is specified');
		done();
		return;
	}

	var folderId;

	var request = serverUtils.getRequest();
	var loginPromises = [];

	if (resourceFolder) {
		loginPromises.push(serverUtils.loginToServer(server, request));
	}

	Promise.all(loginPromises).then(function (results) {
		if (resourceFolder && (!results || results.length === 0 || !results[0].status)) {
			console.log(' - failed to connect to the server');
			done();
			return;
		}

		var resourcePromises = [];
		if (resourceFolder) {
			if (resourceType === 'site') {
				resourcePromises.push(server.useRest ? sitesRest.getSite({
					server: server,
					name: resourceName
				}) : serverUtils.getSiteFolderAfterLogin(server, resourceName));
			} else if (resourceType === 'theme') {
				resourcePromises.push(server.useRest ? sitesRest.getTheme({
					server: server,
					name: resourceName
				}) : _getThemeGUID(request, server, resourceName));
			} else {
				resourcePromises.push(server.useRest ? sitesRest.getComponent({
					server: server,
					name: resourceName
				}) : _getComponentGUID(request, server, resourceName));
			}
		}

		Promise.all(resourcePromises).then(function (results) {
				var rootParentId = 'self';
				if (resourceFolder) {
					var resourceGUID;
					if (results.length > 0 && results[0]) {
						resourceGUID = results[0].id;
					}

					if (!resourceGUID) {
						console.log('ERROR: invalid ' + resourceType + ' ' + resourceName);
						return Promise.reject();
					}
					rootParentId = resourceGUID;
				}

				return _findFolder(server, rootParentId, folderPath);
			})
			.then(function (result) {
				if (!result || result.err || !result.id) {
					return Promise.reject();
				}
				folderId = result.id;
				return serverRest.deleteFolder({
					server: server,
					fFolderGUID: folderId
				});
			})
			.then(function (result) {
				if (result && result.err) {
					return Promise.reject();
				}

				console.log(' - folder ' + argv.path + ' deleted');
				done(true);
			})
			.catch((error) => {
				done();
			});
	}); // login
};