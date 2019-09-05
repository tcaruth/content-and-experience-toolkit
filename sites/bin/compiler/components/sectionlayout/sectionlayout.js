/**
 * Confidential and Proprietary for Oracle Corporation
 *
 * This computer program contains valuable, confidential, and
 * proprietary information. Disclosure, use, or reproduction
 * without the written authorization of Oracle is prohibited.
 * This unpublished work by Oracle is protected by the laws
 * of the United States and other countries. If publication
 * of this computer program should occur, the following notice
 * shall apply:
 *
 * Copyright (c) 2019 Oracle Corp.
 * All rights reserved.
 *
 * $Id: sectionlayout.js 167153 2019-01-25 21:29:15Z dpeterso $
 */
var fs = require('fs'),
	path = require('path'),
	cheerio = require('cheerio');

var factoryToNameMap = {
	"scs-horizontal": "horizontal",
	"scs-slider": "slider",
	"scs-tabs": "tabs",
	"scs-three-columns": "three-columns",
	"scs-two-columns": "two-columns",
	"scs-vertical": "vertical"
};

var applyStyles = function ($div, slData) {
	var settings = slData;
	var css = {};
	var name,
		value;

	// For numeric css values (only), ensure they have the suffix "px"
	var toPixelValue = function (value) {
		value = "" + value;
		if (value.match(/^[0-9]+$/)) {
			value += "px";
		}

		return value;
	};

	if (settings) {
		if ((settings.useStyleClass === true) ||
			((typeof settings.useStyleClass === 'string') && ('TRUE' === settings.useStyleClass.toUpperCase()))) {
			if (settings.styleClass && (typeof settings.styleClass === 'string')) {
				$div.addClass(settings.styleClass);
			}
		} else {
			for (name in settings) {
				if (name && (typeof name === 'string') &&
					Object.prototype.hasOwnProperty.call(settings, name) &&
					(0 === name.indexOf('border'))) {
					value = settings[name];
					name = ('border-' + name.substring('border'.length)).toLowerCase();
					css[name] = toPixelValue(value);
				}
			}

			$div.css(css);
		}
	}
};

var SectionLayout = function (componentId, componentInstanceObject, componentsFolder) {
	this.componentId = componentId;
	this.componentInstanceObject = componentInstanceObject;
	this.componentsFolder = componentsFolder;
};
SectionLayout.prototype = {
	compile: function (parameters) {
		var self = this;

		return this.compileComponent(parameters).then(function (compiledData) {
			var content = (compiledData && compiledData.content) || '';
			var subComponentIds = [];

			if (content) {
				var slData = (self.componentInstanceObject && self.componentInstanceObject.data) || {};
				var $ = cheerio.load('<div>');

				// Add the grid to the DOM - Add an extra <div> here so we can successfully call .html() in a few moments
				var $grid = $('<div><div class="scs-container-styles"><div class="scs-component-content"></div></div><div>');
				applyStyles($grid.find('.scs-container-styles'), slData);

				// Set the initial state to hidden if so configured
				var isMobile = false; // renderAPI.getDeviceInfo().isMobile;
				var visibleIsFalse = (slData.visible === false);
				var isVisible = (isMobile && (typeof slData.visibleOnMobile === 'boolean')) ?
					this.data.visibleOnMobile :
					!visibleIsFalse;
				if (!isVisible) {
					$grid.find('.scs-container-styles').css('display', 'none');
				}

				// Finalize the markup
				$grid.find('.scs-component-content').append($(content));
				content = $grid.html();

				// Obtain a list of child componentIds.  Either use the declared list or compute it.
				if (Array.isArray(compiledData.componentIds)) {
					subComponentIds = compiledData.componentIds;
				} else {
					$grid.find('div[id]').each(function () {
						var id = $(this).attr('id');
						subComponentIds.push(id);
					});
				}
			}

			return Promise.resolve({
				hydrate: false,
				componentIds: subComponentIds,
				parentClasses: ['scs-sectionlayout'],
				omitBoundingBox: true,
				content: content
			});
		});

	},

	compileComponent: function (parameters) {
		var self = this;
		var instanceObject = this.componentInstanceObject || {};

		return new Promise(function (resolve, reject) {
			try {
				if (instanceObject && instanceObject.id) {
					var sectionLayoutName = instanceObject.id;
					var compileFile;
					var directoryName;
					var ootbSectionLayout = false;

					if (instanceObject.data.componentFactory) {
						// Compute the path to the out-of-the-box or custom section layout
						directoryName = factoryToNameMap[instanceObject.data.componentFactory];
						if (directoryName) {
							compileFile = __dirname + '/' + directoryName + '/compile';
						}
						ootbSectionLayout = true;
					} else {
						// Compute the path to the custom section layout
						compileFile = self.componentsFolder + '/' + sectionLayoutName + '/assets/compile';
					}

					if (compileFile) {
						var SectionLayoutImpl;
						try {
							compileFile = path.normalize(compileFile);

							// verify if we can load the file
							require.resolve(compileFile);

							// ok, file's there, load it in
							SectionLayoutImpl = require(compileFile);
						} catch (e) {
							console.log('no compiler found for section layout: ' + sectionLayoutName);
							return resolve({});
						}

						var logic;
						if (ootbSectionLayout) {
							logic = new SectionLayoutImpl(self.componentId, self.componentInstanceObject, self.componentsFolder);
						} else {
							logic = new SectionLayoutImpl({
								componentId: self.componentId,
								componentInstanceObject: self.componentInstanceObject,
								componentsFolder: self.componentsFolder
							});
						}
						if (logic && (typeof logic.compile === 'function')) {
							logic.compile(parameters).then(function (compileData) {
								// Return the supplied data to the caller
								return resolve({
									content: compileData && compileData.content,
									componentIds: compileData && compileData.componentIds
								});
							}, function () {
								// An error occurred
								return resolve({});
							});
						} else {
							console.log('no compile function found for section layout: ' + sectionLayoutName);
							return resolve({});
						}
					} else {
						console.log('no compiler found for section layout: ' + sectionLayoutName);
						return resolve({});
					}
				} else {
					return resolve({});
				}
			} catch (e) {
				console.log('error compiling section layout: ' + (instanceObject && instanceObject.id));
				console.log(e);
				return resolve({});
			}
		});
	}
};

module.exports = SectionLayout;