var cheerio = require('cheerio');
var request = require('request');
var _ = require('lodash');
var fs = require('fs.extra');
var q = require('q');


/*********************************************************
 * @name Scraper
 *
 * @interface
 *  Exporter.scrape(src {string}, config {object})
 *   - Scrapes a given source website and parses data
 *     based on collections specified in the config.
 *   - Returns an object holding the data found.
 *
 *********************************************************/
function Scraper($, config) {

  var self = this;

  this.config = config;

  // Will hold the scraped data
  // and build up recursively during the process.
  this.scraped = {};

  // Process the current collection
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

  // Parse data for the given group
  this.parseGroup = function() {
    self.groupData = {};

    _.each(self.collection.elements, _.bind(self.parseElement, this));

    if (!_.isEmpty(self.groupData)) {
      return self.groupData;
    }
    return null;
  };

  // Parse a single node by extract data
  // and then applying filter, processors
  // and format.
  this.parseElement = function(element, key) {

    var $this = $(this);

    var $elements = $this.find(element.query);

    var hasMultipleResults = $elements.length > 1;

    // Will be called for each element
    // that matches the query within the given
    // group.
    var parse = function() {
      var $element = $(this);

      var data = Scraper.extract($element, element.attr);
      data = Scraper.filter(data, element.filter);
      data = Scraper.process(data, element.process);
      data = Scraper.format(data, element.format);

      if (data !== undefined && data !== null) {

        // Mainly the case if no group
        // has been specified.
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


// Main execution function
Scraper.scrape = function(src, config) {

  var deferred = q.defer();

  request({
    url: src
  }, function(error, response, body) {

    var $ = cheerio.load(body);

    var scraper = new Scraper($, config);

    _.each(config.collections, _.bind(scraper.parse, scraper));

    deferred.resolve(scraper.scraped);
  });

  return deferred.promise;
};

// Extracts data from a note.
// Uses the given attr to determine which data
// to extrat (default 'text').
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

// Filter the result based on a given
// regex or function.
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

// Creates a collection from all collected result
// sets if no group selector was provided.
// Requires all result sets to be of equal length
// to allow a valid mapping.
Scraper.makeCollection = function(collectionData) {

  var collection = [];
  var length;

  _.each(collectionData, function(values, key) {

    // Set initial length
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

// Allow further processing on a value
// by specifying a processor function.
Scraper.process = function(data, process) {
  if (!data || !process) {
    return data;
  }

  return process(data);
};

// Format to a certain filetype.
// Currently supported: 'number', 'data'
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
        return Number(data.replace(/[^\d.]/g, ''));
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

module.exports = Scraper;