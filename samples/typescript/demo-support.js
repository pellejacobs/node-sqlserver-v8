'use strict'

var fs = require('fs')
var path = require('path')
const assert = require('assert')

var GlobalConn = (function () {
  var connStr = 'set global connection here'

  function getSqlLocalDbPipe (done) {
    var childProcess = require('child_process')
    var oldSpawn = childProcess.spawn

    function mySpawn () {
      //  console.log('spawn called');
      // console.log(arguments);
      return oldSpawn.apply(this, arguments)
    }

    childProcess.spawn = mySpawn

    function extract (a) {
      a = a.trim()
      var idx = a.indexOf('np:')
      if (idx > 0) {
        a = a.substr(idx)
      }
      return a
    }

    var child = childProcess.spawn('sqllocaldb', ['info', 'node'])
    child.stdout.on('data', function (data) {
      var str = data.toString()
      var arr = str.split('\r')
      arr.forEach(function (a) {
        var idx = a.indexOf('np:')
        if (idx > 0) {
          var pipe = extract(a)
          setImmediate(function () {
            done(pipe)
          })
        }
      })
      //  Here is where the output goes
    })
    child.stderr.on('data', function (data) {
      console.log('stderr: ' + data)
      //  Here is where the error output goes
    })
    child.on('close', function (code) {
      //  console.log('closing code: ' + code);
      //  Here you can get the exit code of the script
    })
    child.on('error', function (code) {
      console.log('closing code: ' + code)
      process.exit()
      //  Here you can get the exit code of the script
    })
  }

  var driver = 'SQL Server Native Client 11.0'
  var database = 'scratch'

  function getLocalConnStr (done) {
    getSqlLocalDbPipe(function (pipe) {
      var conn = 'Driver={' + driver + '}; Server=' + pipe + '; Database={' + database + '}; Trusted_Connection=Yes;'
      done(conn)
    })
  }

  function init (sql, done, candidateConnStr) {
    var ds = new DemoSupport()

    if (!candidateConnStr) {
      getLocalConnStr(function (cs) {
        var ret = {
          driver: driver,
          database: database,
          conn_str: cs,
          support: new DemoSupport(sql, cs),
          async: new ds.Async(),
          helper: new ds.EmployeeHelper(sql, cs)
        }
        done(ret)
      })
    } else {
      var ret = {
        driver: driver,
        database: database,
        conn_str: candidateConnStr,
        support: new DemoSupport(sql, candidateConnStr),
        async: new ds.Async(),
        helper: new ds.EmployeeHelper(sql, candidateConnStr)
      }
      done(ret)
    }
  }

  function getConnStr () {
    return connStr
  }

  return {
    init: init,
    getConnStr: getConnStr
  }
})()

function DemoSupport (native) {
  var sql = native

  function Assert () {
    function ifError (err) {
      if (err) {
        console.log('error whilst executing msnodelsqlv8 demo - error is ' + err)
        process.exit()
      }
    }

    function check (test, err) {
      if (!test) {
        console.log('check condition fails in msnodelsqlv8 demo - error is ' + err)
        process.exit()
      }
    }

    this.ifError = ifError
    this.check = check
  }

  function Async () {
    function series (suite, done) {
      var i = 0
      next()

      function next () {
        var fn = suite[i]
        fn(function () {
          iterate()
        })
      }

      function iterate () {
        ++i
        if (i === suite.length) {
          done()
        } else next()
      }
    }

    this.series = series
  }

  function ProcedureHelper (conn) {
    var connStr = conn
    var async = new Async()
    var assert = new Assert()
    var verbose = true

    function createProcedure (procedureName, procedureSql, doneFunction) {
      procedureSql = procedureSql.replace(/<name>/g, procedureName)

      var sequence = [
        function (asyncDone) {
          var createSql = 'IF NOT EXISTS (SELECT *  FROM sys.objects WHERE type = \'P\' AND name = \'' + procedureName + '\')'
          createSql += ' EXEC (\'CREATE PROCEDURE ' + procedureName + ' AS BEGIN SET nocount ON; END\')'
          if (verbose) console.log(createSql)
          sql.query(connStr, createSql, function () {
            asyncDone()
          })
        },

        function (asyncDone) {
          sql.query(connStr, procedureSql,
            function (e) {
              assert.ifError(e, 'Error creating procedure.')
              asyncDone()
            })
        }
      ]

      async.series(sequence,
        function () {
          doneFunction()
        })
    }

    function setVerbose (v) {
      verbose = v
    }

    this.createProcedure = createProcedure
    this.setVerbose = setVerbose
  }

  function EmployeeHelper (native, cstr) {
    var connStr = cstr
    var sql = native
    var verbose = true

    function setVerbose (v) {
      verbose = v
    }

    function extractKey (parsedJSON, key) {
      var keys = []
      parsedJSON.forEach(function (emp) {
        var obj = {}
        obj[key] = emp[key]
        keys.push(obj)
      })
      return keys
    }

    function dropCreateTable (params, doneFunction) {
      var async = new Async()
      var tableName = params.tableName
      var rootPath = params.rootPath || '../../unit.tests'
      var columnName = params.columnName || 'col1'
      var type = params.type
      var theConnection = params.theConnection
      var insert = false
      if (params.hasOwnProperty('insert')) {
        insert = params.insert
      }
      var assert = new Assert()
      var conn

      function readFile (f, done) {
        if (verbose) console.log('reading ' + f)
        fs.readFile(f, 'utf8', function (err, data) {
          if (err) {
            done(err)
          } else {
            done(data)
          }
        })
      }

      var sequence = [

        function (asyncDone) {
          if (theConnection) {
            conn = theConnection
            asyncDone()
          } else {
            sql.open(connStr, function (err, newConn) {
              assert.ifError(err)
              conn = newConn
              asyncDone()
            })
          }
        },

        function (asyncDone) {
          var dropSql = 'DROP TABLE ' + tableName
          if (verbose) console.log(dropSql)
          conn.query(dropSql, function () {
            asyncDone()
          })
        },

        function (asyncDone) {
          var folder = path.join(__dirname, rootPath)
          var fileName = tableName
          if (fileName.charAt(0) === '#') {
            fileName = fileName.substr(1)
          }
          var file = folder + '/sql/' + fileName
          file += '.sql'

          function inChunks (arr, callback) {
            var i = 0
            if (verbose) console.log(arr[i])
            conn.query(arr[i], next)

            function next (err, res) {
              assert.ifError(err)
              assert.check(res.length === 0)
              ++i
              if (i < arr.length) {
                if (verbose) console.log(arr[i])
                conn.query(arr[i], function (err, res) {
                  next(err, res)
                })
              } else {
                callback()
              }
            }
          }

          // submit the SQL one chunk at a time to create table with constraints.
          readFile(file, function (createSql) {
            createSql = createSql.replace(/<name>/g, tableName)
            createSql = createSql.replace(/<type>/g, type)
            createSql = createSql.replace(/<col_name>/g, columnName)
            var arr = createSql.split('GO')
            for (var i = 0; i < arr.length; ++i) {
              arr[i] = arr[i].replace(/^\s+|\s+$/g, '')
            }
            inChunks(arr, function () {
              asyncDone()
            })
          })
        },

        function (asyncDone) {
          if (!insert) {
            asyncDone()
          }
        },

        function (asyncDone) {
          if (theConnection) {
            asyncDone()
          } else {
            conn.close(function () {
              asyncDone()
            })
          }
        }
      ]

      async.series(sequence,
        function () {
          doneFunction()
        })
    }

    function compareEmployee (res, parsedJSON) {
      assert.strictEqual(res.length, parsedJSON.length)
      for (let i = 0; i < res.length; ++i) {
        let lhs = res[i]
        let rhs = parsedJSON[i]
        rhs.ModifiedDate.nanosecondsDelta = 0
        rhs.BirthDate.nanosecondsDelta = 0
        rhs.HireDate.nanosecondsDelta = 0
        assert.strictEqual(lhs.BusinessEntityID, rhs.BusinessEntityID)
        assert.strictEqual(lhs.NationalIDNumber, rhs.NationalIDNumber)
        assert.strictEqual(lhs.LoginID, rhs.LoginID)
        assert.strictEqual(lhs.OrganizationNode.length, rhs.OrganizationNode.length)
        for (let j = 0; i < lhs.OrganizationNode.length; ++j) {
          assert.strictEqual(lhs.OrganizationNode[j], rhs.OrganizationNode[j])
        }
        assert.strictEqual(lhs.OrganizationLevel, rhs.OrganizationLevel)
        assert.strictEqual(lhs.JobTitle, rhs.JobTitle)
        assert.strictEqual(lhs.MaritalStatus, rhs.MaritalStatus)
        assert.strictEqual(lhs.Gender, rhs.Gender)
        assert.strictEqual(lhs.SalariedFlag, rhs.SalariedFlag)
        assert.strictEqual(lhs.VacationHours, rhs.VacationHours)
        assert.strictEqual(lhs.SickLeaveHours, rhs.SickLeaveHours)
        assert.strictEqual(lhs.CurrentFlag, rhs.CurrentFlag)
        assert.deepStrictEqual(lhs.ModifiedDate, rhs.ModifiedDate)
        assert.deepStrictEqual(lhs.BirthDate, rhs.BirthDate)
        assert.deepStrictEqual(lhs.HireDate, rhs.HireDate)
        assert.strictEqual(lhs.rowguid, rhs.rowguid)
      }
    }

    function getJSON (stem) {
      var p = stem || '../../unit.tests/json'
      var folder = path.join(__dirname, p)
      var fs = require('fs')

      var parsedJSON = JSON.parse(fs.readFileSync(folder + '/employee.json', 'utf8'))

      for (var i = 0; i < parsedJSON.length; ++i) {
        const rec = parsedJSON[i]
        rec.OrganizationNode = Buffer.from(rec.OrganizationNode.data, 'utf8')
        rec.BirthDate = new Date(rec.BirthDate)
        rec.BirthDate.nanosecondsDelta = 0
        rec.HireDate = new Date(rec.HireDate)
        rec.HireDate.nanosecondsDelta = 0
        rec.ModifiedDate = new Date(rec.ModifiedDate)
        rec.ModifiedDate.nanosecondsDelta = 0
      }
      return parsedJSON
    }

    this.compareEmployee = compareEmployee
    this.getJSON = getJSON
    this.dropCreateTable = dropCreateTable
    this.extractKey = extractKey
    this.setVerbose = setVerbose

    return this
  }

  this.Async = Async
  this.Assert = Assert
  this.EmployeeHelper = EmployeeHelper
  this.ProcedureHelper = ProcedureHelper
}

exports.DemoSupport = DemoSupport
module.exports.GlobalConn = GlobalConn
