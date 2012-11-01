# fs-notifier

The fs-notifier daemon monitors directories (folders) for changes and
notifies interested scripts about these changes. Changes include

1. Files created
2. Files modified

The daemon always runs on port 8664 on the machine on which it is run.

Sample config file:
'''
[
  { "script": "/home/username/test01.sh",
    "email": "user@domain.net",
    "files": [ "[a-z]{2,3}wiki-([0-9]+)-pages-articles.xml.bz2", ".*\\.c" ]
  },
  { "script": "/home/username/test02.sh",
    "email": "user2@domain.net",
    "files": [ ".*" ]
  }
]
'''
