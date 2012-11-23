# fs-notifier

The fs-notifier daemon monitors directories (folders) for changes and
notifies interested scripts about these changes. Changes include

1. Files created
2. Files modified

The daemon always runs on port 8664 on the machine on which it is
run. For example, [http://localhost:8664/](http://localhost:8664/) if
you are running it on the machine on which you are reading this page.

fs-notifier automatically re-tries failed files up to 5 times.

I personally use fs-notifier as a crude data-driven workflow
management tool, and create pipes of workflows, with each script
consuming the output produced by the previous script in the pipe.


## Sample config file

```
[
  { "script": "/home/username/test01.sh",
    "email": "user@domain.net",
    "files": [ "[a-z]{2,3}wiki-([0-9]+)-pages-articles.xml.bz2", ".*\\.c" ]
  },
  { "script": "/home/username/test02.sh",
    "email": "user2@domain.net",
    "files": [ ".*" ]
  },
  { "smtp": { "user": "username", "password": "password",
              "host": "SMTP host name", "ssl": true
            }
  }
]
```

The ```script``` section is the complete PATH of the script to invoke.

Every script is invoked with just 1 argument, that being the path name
of the file is is supposed to process. Every script returns **Zero
(0)** to indicate success, and a non-zero value to indicate
failure. Failed files for a script are automatically re-tried up to 5
times.

The file names (test01.sh and test02.sh in the example config file
above) of scripts **MUST be unique** since they are used to determine
the status of complete files. i.e. You can NOT have 2 scripts with the
exact same file name.

Additionally, every file name that is being monitored **MUST also be
unique** since the file names (and not their complete path names) are
used to detect if the file has been processed. The rationale behind
using the file name over the file path to check if the file has been
processed is that it makes it easier to move files around directories
without losing their completed status with respect to various scripts.

You can move scripts around as long as their file names remain the
same. i.e ```/home/username/test01.sh``` can be changed to
```/opt/scripts/folder01/folder02/test01.sh```, but you may NOT change
it to ```/home/username/test03.sh```. If you do, then all files
associated with this script will be re-tried. There is however a way
around this (if you really MUST rename a file). See the section
*Running* below.

```email``` is OPTIONAL and if set, an email will be sent to the
specified address every time a script fails to process a given
file. This is detected by checking the **return code** of the
script. **Zero (0)** indicates **success**, and anything else
indicates a failure.

The strings in the ```files``` array are regular expressions that are
used to match against file names. If multiple regular expressions
match a single file name for a given script, then that file is
processed just once.

The configuration entry with a key of ```smtp``` indicates the SMTP
configuration used to send out email in case of script execution
failures.


## Installing

You will need [node.js](http://nodejs.org/) installed on the machine
you wish to install fs-notifier on. Once you have it, just type:

```$ npm install fs-notifier```

## Configuring

Create a configuration file (sample above) and place it at ```$HOME/.fsnotifier```.


## Running

```
$ fs-notifier --watchdir=PATH1 --watchdir=PATH_N --metadatadir=PATH_TO_METADATADIR --config=PATH_TO_CONFIG
```

You may specify as many ```--watchdir``` arguments as the number of
directories you wish to watch.

The ```--metadatadir``` is a directory where the metadata about the
completion status of the various scripts on the files being watched is
stored. This is used in the case when the daemon is stopped and
re-started to determine which files have been successfully processed
by a certain script. This is why it is important (nay ESSENTIAL) to
keep the name of the script the same. If you ABSOLUTELY MUST rename a
script, please also rename the folder under this directory to reflect
the new name of the script.

The ```--config``` is the path to the configuration file in case it
isn't placed at ```$HOME/.fsnotifier```. Please don't use paths like
```~/folder/file``` since ```fs-notifier``` will NOT perform GLOB
expansion.


## Important URLs

* [http://localhost/](http://localhost/): The URL where you can
  monitor the status of your scripts.

* [http://localhost/kill](http://localhost/kill): Kill the fs-notifier
  daemon. If you have used
  [daemontools](http://cr.yp.to/daemontools.html) or
  [forever](https://github.com/nodejitsu/forever) to resetart
  fs-notifier on crashing, then the daemon will restart and re-load
  the configuration file from disk. The daemon also sends the
  ```SIGTERM``` signal to each currently running script.

*
  [http://localhost/reset?script=SCRIPT&file=FILE](http://localhost/reset?script=SCRIPT&file=FILE):
  Load this URL to reset the completed status of a file(FILE) with
  respect to a script(SCRIPT). If the file *FILE* has been marked as
  completed for script *SCRIPT*, then this call will reset the
  completed status and invoke the script *SCRIPT* for the file *FILE*
  in case *FILE* is either created or modified.


## Expected setup

There are many ways to set up fs-notifier, but the expected
environment uses a process monitoring tool such as:

1. [forever](https://github.com/nodejitsu/forever)
2. [daemontools](http://cr.yp.to/daemontools.html)

to monitor the running fs-notifier process (since it blocks). This
ensures that if the process is killed (which it can be by clicking the
*Kill Daemon* link on the main page), then the process monitoring tool
of your choice will re-start it. This is a valid way by which you can
re-load the configuration file. The process will FAIL to restart if
the configuration file is not in a valid JSON format.

When the fs-notifier process is killed, it sends a ```SIGTERM```
signal to each of the scripts that are currently running, so that
those scripts can handle that signal and [dis]gracefully terminate.


## I don't know

I don't know the behaviour of fs-notifier in the following scenarios:

1. ```--watchdir``` is a symlink.

2. ```--watchdir``` contains a symlink of another ```--watchdir```
argument.

3. The directory in ```--watchdir``` is deleted and re-created after
the daemon is started.

4. The directory ```--metadatadir``` does NOT have the necessary
permissions for the fs-notifier daemon to create directories and write
files to it.

5. The same directory is specified in both the ```--metadatadir``` as
well as the ```--watchdir``` arguments.
