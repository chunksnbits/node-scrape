var cheerio = require('cheerio');
var request = require('request');
var _ = require('lodash');
var fs = require('fs.extra');
var q = require('q');

function Scraper($, config) {

  var self = this;

  this.config = config;
  this.scraped = {};

  this.parse = function(collection) {
    self.collection = collection;

    var $group = collection.group ? $(collection.group) : $('body');

    var collectionData = _.toArray($group.map(self.parseGroup));

    if (collectionData.length > 0) {
      if (collection.group) {
        self.scraped[collection.name] = collectionData;
      } else {
        self.scraped[collection.name] = Scraper.makeCollection(collectionData[0]);
      }
    }
  };

  this.parseGroup = function() {
    self.groupData = {};

    _.each(self.collection.elements, _.bind(self.parseElement, this));

    if (!_.isEmpty(self.groupData)) {
      return self.groupData;
    }
    return null;
  };

  this.parseElement = function(element, key) {

    var $this = $(this);

    var $elements = $this.find(element.query);

    var hasMultipleResults = $elements.length > 1;

    var parse = function() {
      var $element = $(this);

      var data = Scraper.extract($element, element.attr);
      data = Scraper.filter(data, element.filter);
      data = Scraper.process(data, element.process);
      data = Scraper.format(data, element.format);

      if (data !== undefined && data !== null) {
        if (hasMultipleResults) {
          self.groupData[key] = self.groupData[key] || [];
          self.groupData[key].push(data);
        } else {
          self.groupData[key] = data;
        }
      }
    };

    $elements.each(parse);
  };
}

Scraper.scrape = function(config) {

  var deferred = q.defer();
  var exporter = new Exporter();

  request({
    url: config.src
  }, function(error, response, body) {

    var $ = cheerio.load(body);

    var scraper = new Scraper($, config);

    _.each(config.collections, _.bind(scraper.parse, scraper));

    exporter.export(config.dest, scraper.scraped);

    deferred.resolve(scraper.scraped);
  });

  return deferred.promise;
};

Scraper.extract = function($element, attr) {

  // text extraction is default, if nothing
  // is provided.
  attr = attr || 'text';

  switch (attr) {

    // Handle html specially,
    // will also return html markup
    case 'html':
      {
        return $element.html();
      }

      // Will escape html markup
    case 'text':
      {
        return $element.text();
      }

      // Otherwise apply the attribute
      // selector on the given attribute
    default:
      {
        return $element.attr(attr);
      }
  }
};

Scraper.filter = function(data, filter) {

  // No result found or no filter
  // provided.
  if (!data || !filter) {
    return data;
  }

  // If filter is a function
  // apply function...
  if (_.isFunction(filter)) {
    return filter(data);
  }

  // ...else process as regex
  var regex = new RegExp(filter);
  var matches = regex.exec(data);

  if (!matches) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    return matches[1];
  }

  return null;
};

Scraper.makeCollection = function(collectionData) {

  var collection = [];
  var length;

  _.each(collectionData, function(values, key) {
    length = length || values.length;

    if (length !== values.length) {
      throw new Error('Illegal format. Each entry in a collection must yield exactly the same number of results. Error encountered on key: ' + key);
    }

    _.each(values, function(value, index) {
      collection[index] = collection[index] || {};
      collection[index][key] = value;
    });
  });

  return collection;
};

Scraper.process = function(data, process) {
  if (!data || !process) {
    return data;
  }

  return process(data);
};

Scraper.format = function(data, format) {
  if (!data || !format) {
    return data;
  }

  if (_.isFunction(format)) {
    return format(data);
  }

  switch (format) {
    case 'number':
      {
        return Number(data.replace(/[^\d.]/, ''));
      }
    case 'date':
      {
        return new Date(data);
      }
    default:
      {
        return data;
      }
  }
};

/*********************************************************
 * @name Exporter
 *
 * @type Class
 *
 * @options
 *   - cwd: The current working directory to base the
 *          filepath on
 *
 * @interface
 *  Exporter.export(filepath {string}, data {object})
 *   - Writes a javascript (json) object to the
 *     specified filepath.
 *
 * @description
 *  Helper class for writing json data to the
 *  file system in various formats.
 *
 *  Currently supported:
 *    - JSON
 *    - CSV
 *    - XML
 *
 *********************************************************/
function Exporter() {
  this.cwd = process.cwd();

  this.export = function(filepath, data) {

    filepath = getOrCreateWorkingFilepath(filepath, this.cwd);

    var ending = parseFiletype(filepath);
    var strategy = Exporter.strategies[ending];

    if (!strategy) {
      throw new Error('Could not export data. The filetype "' + ending + '" is not supported. Please specify an ending of: "' + _.keys(Exporter.strategies).join('", "') + '"');
    }

    return strategy.export(filepath, data);
  };

  var getOrCreateWorkingFilepath = function(filepath, cwd) {
    var outputFile = cwd + '/' + filepath;

    var outputPath = outputFile.replace(/\/([^\/]+)$/, '');

    if (!fs.existsSync(outputPath)) {
      fs.mkdirRecursiveSync(outputPath);
    }

    return outputFile;
  };

  var parseFiletype = function(filepath) {
    var matches = filepath.match(/\.([^.]*)$/);
    if (matches.length !== 2) {
      throw new Error('Could not determine export type. Please specify a filetype ending on the "dest" attribute.');
    }

    return matches[1];
  };
}

/*********************************************************
 * @name Exporter.strategies
 *
 * @type Class
 *
 * @interface
 *  Exporter.strategies[strategie].export(
 *                filepath {string}, data {object})
 *
 *   - Writes a javascript (json) object to the
 *     specified filepath using the specified stragety
 *
 * @description
 *  Helper class for writing json data to the
 *  file system in various formats.
 *
 *  Currently supported:
 *    - JSON
 *    - CSV
 *    - XML
 *
 *********************************************************/
Exporter.strategies = {
  csv: {
    export: function(filepath, data) {
      var converter = require('json-2-csv');

      var key = _.keys(data)[0];

      converter.json2csv(data[key], function(error, csv) {
        if (error) {
          throw error;
        }
        fs.writeFileSync(filepath, csv);
      });
    }
  },
  json: {
    export: function(filepath, data) {
      fs.writeFileSync(filepath, JSON.stringify(data));
    }
  },
  xml: {
    export: function(filepath, data) {
      var converter = require('easyxml');

      converter.configure({
        singularizeChildren: true,
        rootElement: 'data',
        indent: 2,
        manifest: true
      });

      var xml = converter.render(data);

      fs.writeFileSync(filepath, xml);
    }
  }
};

module.exports = Scraper;