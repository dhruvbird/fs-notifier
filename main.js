var fs      = require('fs');
var assert  = require('assert').ok;
var path    = require('path');
var _       = require('underscore');
var spawn   = require('child_process').spawn;
var watch   = require('watch');
var crypto  = require('crypto');
var http    = require('http');
// var email   = require('emailjs');

var config = [ ];

// { script_name: { path: path of file being processed, started: Time when the script was started } }
var running = { };

// { script_name: { files: [ list of files that script should be run for ] } }
var toProcess = { };

// { script_name: [ { path: path of file already processed for this script, status: status code, duration: running time in sec } ] }
var processed = { };

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
    console.error("spawn_process(", script, ",", params, ")");
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

function handleWebRequest(req, res) {
    var styles = "body { padding-left: 20px; padding-right: 20px; font-family: PTSansRegular,Arial,Sans-Serif; }\n";
    var page = "<html><head><title>fs-notifer status page</title>\n<style type='text/css'>\n" + styles + "</style>\n</head>\n";
    var i, j;
    page += "<body>\n<center><h1>fs-notifier status page</h1></center>\n";

    if (Object.keys(running).length > 0) {
        page += "<h2>Status of currently running scripts</h2>\n";
        page += "<table border='1'><tr><th>Script Name</th><th>Processing File</th><th>Running Since</th><th>Running For (sec)</th></tr>\n";
        var scripts = Object.keys(running);
        for (i = 0; i < scripts.length; ++i) {
            var r = running[scripts[i]];
            page += "<tr><td>" + scripts[i] + "</td><td>" + r.path + "</td><td>" + String(r.started) + "</td><td>" +
                String(Math.round((new Date() - r.started)/1000)) + "</td></tr>\n";
        }
        page += "</table>\n\n";
    } else {
        page += "<h2>No scripts are currently running</h2>\n";
    }

    if (Object.keys(toProcess).length > 0) {
        page += "<h2>List of queued files</h2>\n";
        page += "<table border='1'><tr><th>Target Script Name</th><th>Queued File(s)</th></tr>\n";
        var scripts = Object.keys(toProcess);
        for (i = 0; i < scripts.length; ++i) {
            var tp = toProcess[scripts[i]];
            page += "<tr><td>" + scripts[i] + "</td><td>\n<ol>\n";
            for (j = 0; j < tp.files.length; ++j) {
                page += "<li>" + tp.files[j] + "</li>\n";
            }
            page += "</ol>\n</td>\n</tr>\n";
        }
        page += "</table>\n\n";
    } else {
        page += "<h2>No files are currently queued</h2>\n";
    }

    if (Object.keys(processed).length > 0) {
        page += "<h2>Status of already processed files</h2>\n";
        page += "<table border='1'><tr><th>Target Script Name</th><th>Status</th></tr>\n";
        var scripts = Object.keys(processed);
        for (i = 0; i < scripts.length; ++i) {
            var p = processed[scripts[i]];
            page += "<tr><td>" + scripts[i] + "</td><td>\n<ol>\n";
            for (j = 0; j < p.length; ++j) {
                page += "<li>For <i>" + p[j].path + "</i> ran for <i>" + p[j].duration +
                    " second</i> and exited with code <i>" +
                    p[j].status + "</i></li>\n";
            }
            page += "</ol>\n</td>\n</tr>\n";
        }
        page += "</table>\n\n";
    } else {
        page += "<h2>No status for processed files</h2>\n";
    }

    if (config.length > 0) {
        page += "<h2>List of configured scripts</h2>\n";
        page += "<table border='1'><tr><th>Target Script Name &amp; email</th><th>File Regular Expressions</th></tr>\n";
        var scripts = config;
        for (i = 0; i < scripts.length; ++i) {
            var s = scripts[i].script;
            var e = scripts[i].email;
            var f = scripts[i].files;
            page += "<tr><td>" + s + "<br/>" + e + "</td><td>\n<ol>\n";
            for (j = 0; j < f.length; ++j) {
                page += "<li>" + f[j].source + "</li>\n";
            }
            page += "</ol>\n</td>\n</tr>\n";
        }
        page += "</table>\n\n";
    } else {
        page += "<h2>No scripts currently configured</h2>\n";
    }

    page += "<br/><br/><br/><br/><br/><br/><hr/>\n";
    page += "<div style='font-size: 12px; float:right;'>\n";
    page += "<i>Rendered by <a href='https://github.com/dhruvbird/fs-notifier'>fs-notifier</a></i> at <i>" + String(new Date()) + "</i>\n";
    page += "</div>\n<br/><br/></body></html>\n";
    res.end(page);
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

            if (!processed.hasOwnProperty(script)) {
                processed[script] = [ ];
            }
            processed[script].push({
                path: running[script].path,
                status: code,
                duration: Math.round((new Date() - running[script].started)/1000)
            });
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
        } else {
            // Delete the entry in toProcess for 'script'
            delete toProcess[script];
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

    var server = http.createServer(handleWebRequest);

    server.listen(8664);
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
            note: 'The path of the configuration file (default: ' + process.env.HOME + '/.fsnotifier)',
            value: process.env.HOME + '/.fsnotifier'
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
