var fs      = require('fs');
var os      = require('os');
var assert  = require('assert').ok;
var path    = require('path');
var _       = require('underscore');
var spawn   = require('child_process').spawn;
var watch   = require('watch');
var crypto  = require('crypto');
var http    = require('http');
var url     = require('url');
var email   = require('emailjs');
var ejs     = require('ejs');

var HTTP_LISTEN_PORT = 8664;

var config = [ ];
var smtp   = { };

// { script_name: {
//                  path: path of file being processed,
//                  started: Time when the script was started,
//                  num_retries: # of runs for this file,
//                  pobj: The Process Object for this script
//                }
// }
var running = { };

// { script_name: { files: [ list of files that script should be run for ] } }
var toProcess = { };

// { script_name: [ {
//                    path: path of file already processed for this script,
//                    status: status code,
//                    duration: running time in sec,
//                    num_retries: The # of times this file has been re-tried for this script
//                   }
//                ]
// }
var processed = { };

// { script_path: { file_name0: file_path0, ..., file_nameN: file_pathN } }
var scriptFiles = { };

// { script_path: { file_name0: [ file_path0, ..., file_pathN ] } }
var dupFiles = { }

var watchdirs   = '';
var metadatadir = '';

function send_email(from, to, subject, body) {
    if (!smtp.hasOwnProperty('user')) {
        return;
    }
    var server = email.server.connect({
	user:     smtp.user,
	password: smtp.password,
	host:     smtp.host,
	ssl:      smtp.ssl
    });

    var message = {
	text:    body,
	from:    from,
	to:      to,
	subject: subject
    };
    server.send(message, function(err, message) { if (err) console.error(err.stack); });
}

function getFlagFilePath(script, filePath) {
    var scriptName = path.basename(script);
    var ret = path.join(metadatadir, scriptName);
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
    return w;
}

function handleWebRequest(req, res) {
    // console.log(req.url);
    if (req.url.search("/kill") === 0) {
        var html = "<html><head><meta http-equiv=\"refresh\" content=\"4;url=/\"></head>\n" +
            "<body>Exiting... Click <a href=\"/\">here</a> to reload the status page if you aren't automatically redirected there in 4 second.</body></html>\n";
        res.end(html);
        process.nextTick(function() {
            on_SIGINT();
        });
        return;
    }
    if (req.url.search("/getscript") === 0) {
        var u = url.parse(req.url, true);
        var query = u.query;
        var pathName = null;
        if (u.query) {
            pathName = query.path;
        }
        res.setHeader('Content-Type', 'text/plain');

        if (!pathName || _.pluck(config, 'script').indexOf(pathName) === -1 || !path.existsSync(pathName)) {
            // Either the pathName is empty or it doesn't exist or is
            // not configured as a valid script we are managing.
            res.end("Sorry, but you can't read the file '" + pathName + "'. Click 'Back' on your browser to go back.");
        } else {
            // We assume that the script is a text file.
            res.end(fs.readFileSync(pathName));
        }
        return;
    }
    var indexTemplate = fs.readFileSync(require.resolve('./index.html'), 'utf8');
    var html = ejs.render(indexTemplate, {
        hostname:  os.hostname(),
        dupFiles:  dupFiles,
        running:   running,
        toProcess: toProcess,
        processed: processed,
        config:    config,
        watchdirs: watchdirs,
        compactFileName: path.basename,
        _:         _
    });
    res.setHeader("Content-Type", "text/html");
    res.end(html);
}

function start_watching() {
    function addToQ(script, file) {
        console.error("addToQ(", script, ",", file, ")");

        if (!toProcess.hasOwnProperty(script)) {
            toProcess[script] = { files: [ ] }
        }

        if (!scriptFiles.hasOwnProperty(script)) {
            scriptFiles[script] = { };
        }

        // Check if filePath has already been added to the list of
        // files to process or already processed file or is currently
        // being processed.
        var fileName = path.basename(file);
        if (scriptFiles[script].hasOwnProperty(fileName)) {
            // This file exists. Check if it exists with the same
            // path.
            if (scriptFiles[script][fileName] != file) {
                // There is another file with the same name. Add to
                // 'dupFiles'.
                if (!dupFiles.hasOwnProperty(script)) {
                    dupFiles[script] = { };
                }
                if (!dupFiles[script].hasOwnProperty(fileName)) {
                    dupFiles[script][fileName] = [ ];
                }
                var paths = dupFiles[script][fileName];
                paths.push(file);
                paths.push(scriptFiles[script][fileName]);
                dupFiles[script][fileName] = _.uniq(paths);
            }
            return;
        }

        scriptFiles[script][fileName] = file;
        toProcess[script].files.push(file);
        if (!running.hasOwnProperty(script)) {
            // 'script' is currently NOT running.
            runScript(script, 0);
        }
    }

    function getNextEntryForScript(script) {
        // This function fetches the next file to process for the
        // script with name 'script'
        var nextFile = null;
        if (toProcess[script] && toProcess[script].files.length > 0) {
            nextFile = toProcess[script].files[0];
            toProcess[script].files.shift();
            if (toProcess[script].files.length === 0) {
                delete toProcess[script];
            }
        }

        if (nextFile) {
            return { path: nextFile, started: new Date(), num_retries: 1 };
        }

        var failedFilesForScript = (processed[script] || [ ]).filter(function(entry) {
            if (entry.status != 0 && entry.num_retries < 5) {
                // We don't retry a failed file more than 5 times.
                return true;
            }
            return false;
        });

        if (failedFilesForScript.length > 0) {
            var pos = 0;
            var e1 = failedFilesForScript[0];
            processed[script].forEach(function(entry, index) {
                if (entry.path == e1.path) {
                    pos = index;
                }
            });
            processed[script].splice(pos, 1);
            e1.num_retries = e1.num_retries + 1;
            return { path: e1.path, started: new Date(), num_retries: e1.num_retries };
        }
        return null;
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
                // Not successful. Send email.
                var c = config.reduce(function(prev, curr) {
                    if (curr.script === script) {
                        return curr;
                    }
                    return prev;
                }, { });
                if (c.hasOwnProperty('email')) {
                    var rinfo = running[script];
                    var body = "The script '" + script + "' ran for " +
                        Math.round((new Date() - running[script].started)/1000) +
                        " second and failed to process the file '" +
                        rinfo.path + "' " + rinfo.num_retries + " time(s).\n";
                    send_email('fs-notifier daemon <no-reply@fsnotifier.net>', c.email,
                               '[fs-notifier] ' + script + ' failed', body);
                }
            }

            if (!processed.hasOwnProperty(script)) {
                processed[script] = [ ];
            }
            processed[script].push({
                path: running[script].path,
                status: code,
                duration: Math.round((new Date() - running[script].started)/1000),
                num_retries: running[script].num_retries
            });
            delete running[script];
        }

        var nextEntry = getNextEntryForScript(script);
        if (nextEntry) {
            running[script] = nextEntry;
            nextEntry.pobj = spawn_process(script, [ nextEntry.path ], runScript);
        }
    }

    function foundFile(filePath) {
        console.error("foundFile(", filePath, ")");
        if (!path.existsSync(filePath)) {
            return;
        }
        var fileName = path.basename(filePath);
        // Check if 'filePath' matches any Regular Expression that any of
        // the scripts are interested in.
        var i, j;
        for (i = 0; i < config.length; ++i) {
            var c = config[i].files;

            for (j = 0; j < c.length; ++j) {
                if (fileName.match(c[j])) {
                    // Check if this file has been processed for the
                    // script we are processing.
                    var flagFilePath = getFlagFilePath(config[i].script, filePath);
                    if (!path.existsSync(flagFilePath)) {
                        addToQ(config[i].script, filePath);
                        // Do NOT add a file multiple times (in case it matches multiple REs).
                        break;
                    }
                }
            }
        }
    }

    watchdirs.forEach(function(watchdir) {
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
    });

    var server = http.createServer(handleWebRequest);
    server.listen(HTTP_LISTEN_PORT);
}

function duplicates(array, proc) {
    proc = proc || function(x,y) { return x==y; }
    if (array.length === 0) { return [ ]; }
    array.sort();
    var i = 1;
    var dups = [ ];
    var prev = array[0];
    var has_prev = false;
    for (i = 1; i < array.length; ++i) {
        if (proc(prev, array[i])) {
            if (!has_prev) {
                has_prev = true;
                dups.push(prev);
            }
            dups.push(array[i]);
        } else {
            prev = array[i];
            has_prev = false;
        }
    }
    return dups;
}

function main() {
    var opts = require('tav').set({
        'watchdir': {
            note: 'The path(s) of the directory(s) to watch (required)',
            value: [ ]
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

    console.log(opts);

    var numNonExistentWatchDirs = opts.watchdir.reduce(function(prev, curr) {
        if (!path.existsSync(curr)) {
            console.error("The directory '" + curr + "' does NOT exist.");
            prev = prev + 1;
        }
        return prev;
    }, 0);

    if (opts.watchdir.length === 0 || numNonExistentWatchDirs > 0) {
        console.error("You must specify the directories to watch and they must exist");
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

    watchdirs   = _.uniq(opts.watchdir);
    metadatadir = opts.metadatadir;

    // Load the config file.
    config = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
    smtp = _.chain(config).pluck('smtp').compact().first().value() || { }
    config = config.filter(function(e) { return e.hasOwnProperty('script'); });
    // console.log(config, smtp);

    // Convert entries to regular expressions.
    config = config.map(function(e) {
        e.files = e.files.map(function(reStr) {
            return new RegExp(reStr, "i");
        });
        return e;
    });

    var allScriptNames    = _.pluck(config, 'script').map(path.basename);
    var dups = duplicates(allScriptNames);

    if (dups.length > 0) {
        console.error("The following script names are not unique: " + String(dups));
        return;
    }

    // console.log(config);
    start_watching();
}

function on_SIGINT() {
    var runningScripts = Object.keys(running);
    runningScripts.forEach(function(script) {
        var sObj = running[script];
        console.log("Sending the 'SIGTERM' signal to the process running script '" + script + "'");
        sObj.pobj.kill('SIGTERM');
    });
    process.exit(1);
}

process.on('SIGINT', on_SIGINT);

main();
