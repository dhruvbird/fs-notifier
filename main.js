var fs      = require('fs');
var assert  = require('assert').ok;
var path    = require('path');
var _       = require('underscore');
var spawn   = require('child_process').spawn;
var watch   = require('watch');
var crypto  = require('crypto');

// var email   = require('emailjs');

var config = [ ];

// { script_name: { path: path of file being processed, started: Time when the script was started } }
var running = { };

// { script_name: { files: [ list of files that script should be run for ] } }
var toProcess = { };

var watchdir = '';
var metadatadir = '';

function getFlagFilePath(script, filePath) {
    var shasum = crypto.createHash('sha1');
    var scriptName = path.basename(script);
    shasum.update(script);
    var d = shasum.digest('hex').substring(0, 5);
    var ret = path.join(metadatadir, scriptName + "_" + d, path.basename(filePath));
    return ret;
}

function mkdirSync(p, mode) {
    mode = mode || '0755';
    if (p == '.' || p == '/') {
        return;
    }
    var dir = path.dirname(p);
    mkdirSync(dir, mode);
    try {
        return fs.mkdirSync(p, mode);
    } catch(ex) {
        // console.error("util.js::mkdirSync::", ex);
    }
    return 0;
}

function spawn_process(script, params, cb) {
    var w = spawn(script, params);

    w.stdout.on('data', function(data) {
        process.stdout.write("[" + script + "] " + data.toString());
    });
    w.stderr.on('data', function(data) {
        process.stderr.write("{" + script + "} " + data.toString());
    });
    w.on('exit', function(code) {
        // console.error("Process Exited with code:", code);
        cb(script, code);
    });
}

function start_watching() {
    function addToQ(script, file) {
        console.error("addToQ(", script, ",", file, ")");
        if (!toProcess.hasOwnProperty(script)) {
            toProcess[script] = { files: [ ] }
        }
        toProcess[script].files.push(file);
        if (!running.hasOwnProperty(script)) {
            // 'script' is currently NOT running.
            runScript(script, 0);
        }
    }

    function runScript(script, code) {
        console.error("runScript(", script, ",", code, ")");
        if (running.hasOwnProperty(script)) {
            if (code == 0) {
                // Mark the currently processed file as processed
                // w.r.t. the current script.
                var flagFilePath = getFlagFilePath(script, running[script].path);
                var d = path.dirname(flagFilePath);
                mkdirSync(d);
                fs.writeFileSync(flagFilePath, '', 'utf8');
            } else {
                // Not successful. TODO: Send email.
            }

            // Remove from toProcess list.
            toProcess[script].files.shift();

            delete running[script];
        }

        var nextFile = toProcess[script].files[0];
        while (nextFile && path.existsSync(getFlagFilePath(script, nextFile))) {
            toProcess[script].files.shift();
            nextFile = toProcess[script].files[0];
        }

        if (nextFile) {
            running[script] = { path: nextFile, started: new Date() };
            spawn_process(script, [ nextFile ], runScript);
        }
    }

    function foundFile(filePath) {
        console.error("foundFile(", filePath, ")");
        var fileName = path.basename(filePath);
        // Check if 'filePath' matches any Regular Expression that any of
        // the scripts are interested in.
        var i, j;
        for (i = 0; i < config.length; ++i) {
            var c = config[i].files;

            for (j = 0; j < c.length; ++j) {
                if (fileName.match(c[i])) {
                    // Check if this file has been processed for the
                    // script we are processing.
                    var flagFilePath = getFlagFilePath(config[i].script, filePath);
                    if (!path.existsSync(flagFilePath)) {
                        addToQ(config[i].script, filePath);
                    }
                }
            }
        }
    }

    watch.watchTree(watchdir, {
        ignoreDotFiles: true,
        filter: function(filePath) { foundFile(filePath); return false; }
    }, function() { });

    watch.createMonitor(watchdir, function(monitor) {
        monitor.on('created', function(filePath, stat) {
            foundFile(filePath);
        });
        monitor.on('changed', function(filePath, stat, prevstat) {
            foundFile(filePath);
        });
    });
}

function main() {
    var opts = require('tav').set({
        'watchdir': {
            note: 'The path of the directory to watch (required)', 
            value: ''
        },
        'metadatadir': {
            note: 'The path of the directory where the metadata is to be stored (required)', 
            value: ''
        },
        'config': {
            note: 'The path of the configuration file (default: ~/.fsnotifier)', 
            value: '~/.fsnotifier'
        }
    }, 'Watch a directory for changes and invoke a script that is configured to watch files');

    if (!opts.watchdir || !path.existsSync(opts.watchdir)) {
        console.error("You must specify the directory to watch and it must exist");
        return;
    }

    if (!opts.metadatadir || !path.existsSync(opts.metadatadir)) {
        console.error("You must specify the metadata directory and it must exist");
        return;
    }

    if (!path.existsSync(opts.config)) {
	console.error("You must create the config file at '" + opts.config + "' or specify the file at --config");
	return;
    }

    watchdir = opts.watchdir;
    metadatadir = opts.metadatadir;

    // Load the config file.
    config = JSON.parse(fs.readFileSync(opts.config, 'utf8'));

    // console.log(config);

    // Convert entries to regular expressions.

    var i;
    for (i = 0; i < config.length; ++i) {
        config[i].files = config[i].files.map(function(reStr) {
            return new RegExp(reStr, "i");
        });
    }

    // console.log(config);
    start_watching();

}

main();
