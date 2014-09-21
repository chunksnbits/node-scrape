/* jshint node:true */

'use strict';

var jsdom = require('jsdom');
var $ = require('jquery');
var _ = require('lodash');
var q = require('q');
var flatnest = require("flatnest")

/*********************************************************
 * @name Scraper
 *
 * @interface
 * Exporter.scrape(src {
   string
 }, config {
   object
 })
 *   - Scrapes a given source website and parses data
 *     based on collections specified in the config.
 *   - Returns an object holding the data found.
 *
 *********************************************************/
function Scraper($, config, requestParameters) {

  var self = this;

  this.config = config;

  // Will hold the scraped data
  // and build up recursively during the process.
  this.scraped = {};

  this.requestParameters = requestParameters;

  // Process the current collection
  this.parse = function(collection) {
    self.collection = collection;

    var $group = collection.group ? $(collection.group) : $('body');

    var collectionData = _.toArray($group.map(self.parseGroup));

    if (collectionData.length > 0) {
      if (!collection.group) {
        collectionData = Scraper.makeCollection(collectionData[0]);
      }

      // Apply static value processing on each value of the
      // extracted collection.
      if (collection.each) {
        collectionData = Scraper.each(collection, collectionData, this.requestParameters);
      }

      console.log(_.first(collectionData));

      self.scraped[collection.name] = collectionData;
    }
  };

  // Parse data for the given group
  this.parseGroup = function() {
    self.groupData = {};

    _.each(self.collection.elements, _.bind(self.parseElement, this));

    if (!_.isEmpty(self.groupData)) {

      // For group queries resolve tree structure
      // (e.g., 'a.b.c' --> { a: { b: { c: 'value' }}})
      // at this point for grouped collections.
      // For non-grouped collections, resolve nesting
      // in makeCollection step.
      if (self.collection.group) {
        return flatnest.nest(self.groupData);
      }
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

      data = Scraper.trim(data);
      data = Scraper.filter(data, element.filter);
      data = Scraper.format(data, element.format);

      if (data !== undefined) {

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

  var urls = Scraper.collectUrls(src, config.params);

  var promises = [];
  var result = [];

  var options = _.extend({}, config.options);


  _.each(urls, function(url) {
    var deferred = q.defer();

    var requestParameters = url.requestParameters;
    url = _.isObject(url) ? url.url : url;

    options.url = url;

    jsdom.env(_.extend(options, {
      loaded: function(error, window) {

        var $window = $(window);

        var scraper = new Scraper($window, config, requestParameters);

        _.each(config.collections, _.bind(scraper.parse, scraper));

        var scraped = {
          url: url,
          collections: scraper.scraped
        };

        if (requestParameters) {
          scraped.requestParameters = requestParameters;
        }

        result.push(scraped);

        deferred.resolve();
      }
    }));

    promises.push(deferred.promise);
  });

  return q.all(promises).then(function() {
    return result;
  });
};

Scraper.collectUrls = function(src, params) {

  var urls = _.isArray(src) ? src : [src];

  if (!params) {
    return urls;
  }

  return Scraper.permutateUrls(urls, params);
};

Scraper.permutateUrls = function(urls, options) {

  var extracted = Scraper.extractParams(options);

  var requestOptions = extracted.values;
  var requestKeys = extracted.keys;

  var permutations = Scraper.permutations(requestOptions);

  var permutatedUrls = [];

  _.each(urls, function(url) {
    _.each(permutations, function(permutation) {
      var permutationOptions = {
        url: _.clone(url),
        requestParameters: {}
      };

      _.each(requestKeys, function(key, index) {
        var value = permutation[index];

        permutationOptions.url = permutationOptions.url.replace(':' + key, value);
        permutationOptions.requestParameters[key] = value;
      });

      permutatedUrls.push(permutationOptions);
    });
  });
  return permutatedUrls;
};

Scraper.extractParams = function(options) {
  var keys = [];
  var values = [];

  _.each(options, function(value, key) {
    keys.push(key);
    values.push(_.isArray(value) ? value : [value]);
  });

  return {
    keys: keys,
    values: values
  };
};

Scraper.each = function(collection, collectionData, requestParameters) {
  _.each(collectionData, function (entry, index) {
    _.each(collection.each, function (valueOrFn, key) {
      collectionData[index][key] = _.isFunction(valueOrFn) ? valueOrFn(entry, collection, requestParameters) : valueOrFn;
    });
  });

  return collectionData;
};

// Extracts data from a note.
// Uses the given attr to determine which data
// to extract (default 'text').
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
  if (!data || !filter || !_.isString(data)) {
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

  // Nest nested keys (e.g., 'a.b.c' --> { a: { b: { c: 'value' }}})
  // after collection making process has finished.
  _.each(collection, function(value, index) {
    collection[index] = flatnest.next(value);
  });

  return collection;
};

// Do some basic string processing.
Scraper.trim = function(data) {
  return data.replace(/[\r\n\t]/g, '').trim();
};

// Format to a certain filetype.
// Currently supported: 'number', 'data'
Scraper.format = function(data, format) {
  if (!data || !format || !_.isString(data)) {
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


// Based on a solution for the cartesian product by
// 'Bergi', http://stackoverflow.com/a/15310051
//
// Calculates all possible permutations from
// n-given arrays.
// e.g.,
//
//   Scrape.permutations([1,2], [3], [5,6]) -->
//      [[1,3,4],[1,3,6],[2,3,5],[2,3,6]]
//
Scraper.permutations = function(args) {
  var result = [];
  var max = args.length - 1;

  function recurse(array, argsIndex) {
    var index = args[argsIndex].length;

    while (--index > -1) {
      var clone = array.slice(0); // clone arr
      clone.push(args[argsIndex][index]);
      if (argsIndex < max) {
        recurse(clone, argsIndex + 1);
      } else {
        result.push(clone);
      }
    }
  }
  recurse([], 0);
  return result;
};

module.exports = Scraper;