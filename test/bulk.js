var sql = require('../'),
    assert = require('assert'),
    async = require('async'),
    config = require('./test-config'),
    fs = require('fs');

var conn_str = config.conn_str;

function testBoilerPlate(params, doneFunction) {

    var name = params.name;
    var type = params.type;

    sql.open(conn_str, opened);

    function opened(err, conn) {
        function readFile(f, done) {
            fs.readFile(f, 'utf8', function (err, data) {
                if (err) {
                    done(err);
                } else
                    done(data);
            });
        }

        var sequence = [
            function (async_done) {
                var dropSql = "DROP TABLE " + name;
                conn.query(dropSql, function () {
                    async_done();
                });
            },

            function (async_done) {
                var folder = __dirname;
                var file = folder + '/sql/' + name;
                file += '.sql';

                function inChunks(arr, callback) {
                    var i = 0;
                    conn.query(arr[i], next);
                    function next(err, res) {
                        ++i;
                        if (i < arr.length)
                            conn.query(arr[i], next);
                        else callback();
                    }
                }

                // submit the SQL one chunk at a time to create table with constraints.
                readFile(file, function (createSql) {
                    createSql = createSql.replace(/<name>/g, name);
                    createSql = createSql.replace(/<type>/g, type);
                    var arr = createSql.split("GO");
                    for (var i = 0; i < arr.length; ++i) {
                        arr[i] = arr[i].replace(/^\s+|\s+$/g, '');
                    }
                    inChunks(arr, function () {
                        async_done();
                    });
                });
            },

            function (async_done) {
                var tm = conn.tableMgr();
                tm.bind(name, function (bulkMgr) {
                    assert(bulkMgr.columns.length > 0, "Error creating table");
                    async_done();
                });
            }];

        async.series(sequence,
            function () {
                doneFunction();
            });
    }
}

suite('bulk', function () {

    var c;
    this.timeout(45000);
    var tm;

    /*
    var totalObjectsForInsert = 1000;
    var test1BatchSize = 1;
    var test2BatchSize = 1000;
    */

    var totalObjectsForInsert = 100;
    var test1BatchSize = 1;
    var test2BatchSize = 100;

    setup(function (test_done) {

        sql.open(conn_str, function (err, new_conn) {

            assert.ifError(err);

            c = new_conn;

            test_done();
        });
    });

    teardown(function (done) {

        c.close(function (err) {
            assert.ifError(err);
            done();
        });
    });

    function getJSON(keys) {
        var folder = __dirname;
        var parsedJSON = require(folder + '/employee.json');

        for (var i = 0; i < parsedJSON.length; ++i) {
            parsedJSON[i].OrganizationNode = new Buffer(parsedJSON[i].OrganizationNode.data, 'utf8');
            parsedJSON[i].BirthDate = new Date(parsedJSON[i].BirthDate);
            parsedJSON[i].HireDate = new Date(parsedJSON[i].HireDate);
            parsedJSON[i].ModifiedDate = new Date(parsedJSON[i].ModifiedDate);
        }

        parsedJSON.forEach(function (emp) {
            keys.push({
                BusinessEntityID: emp.BusinessEntityID
            });
        });
        return parsedJSON;
    }

    function nullTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('datetime', function(i) {
            return null;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select null column of datetime batchSize ' + test1BatchSize, function(test_done) {
        nullTest(test1BatchSize, false, test_done);
    });

    test('bulk insert/select null column of datetime batchSize ' + test2BatchSize, function(test_done) {
        nullTest(test2BatchSize, false, test_done);
    });

    function varbinaryTest(batchSize, selectAfterInsert, test_done) {
        var arr = [];
        var str = '';
        for (var i = 0; i < 10; ++i) {
            str = str + i;
            arr.push(new Buffer(str))
        }
        simpleColumnBulkTest('varbinary(100)', function(i) {
            var idx = i % 10;
            var s = arr[idx];
            return  s;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select varbinary column batchSize ' + test1BatchSize, function(test_done) {
        varbinaryTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select varbinary column batchSize ' + test2BatchSize, function(test_done) {
        varbinaryTest(test2BatchSize, true, test_done);
    });

    function dateTest(batchSize, selectAfterInsert, test_done) {
        var dt = new Date('2002-02-06T00:00:00.000Z');
        simpleColumnBulkTest('datetime', function() {
            dt.setTime( dt.getTime() + 86400000 );
            var nt = new Date();
            nt.setTime(dt.getTime());
            return nt;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select datetime column batchSize ' + test1BatchSize, function(test_done) {
        dateTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select datetime column batchSize ' + test2BatchSize, function(test_done) {
        dateTest(test2BatchSize, true, test_done);
    });

    function unsignedTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('int', function(i) {
            return i % 2 == 0 ? -i :  i;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert only int column of unsigned batchSize ' + test1BatchSize, function(test_done) {
        unsignedTest(test1BatchSize, false, test_done);
    });

    test('bulk insert only int column of unsigned batchSize ' + test2BatchSize, function(test_done) {
        unsignedTest(test2BatchSize, false, test_done);
    });

    function signedTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('int', function(i) {
            return i % 2 == 0 ? -i :  i;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select int column of signed batchSize ' + test1BatchSize, function(test_done) {
        signedTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select int column of signed batchSize ' + test2BatchSize, function(test_done) {
        signedTest(test2BatchSize, true, test_done);
    });

    function unsignedTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('int', function(i) {
            return  i * 2;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select int column of unsigned batchSize ' + test1BatchSize, function(test_done) {
        unsignedTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select int column of unsigned batchSize ' + test2BatchSize, function(test_done) {
        unsignedTest(test2BatchSize, true, test_done);
    });

    function bitTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('bit', function(i) {
            return  i % 2 == 0;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select bit column batchSize ' + test1BatchSize, function(test_done) {
        bitTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select bit column ' + test2BatchSize, function(test_done) {
        bitTest(test2BatchSize, true, test_done);
    });

    function decimalTest(batchSize, selectAfterInsert, test_done) {
        simpleColumnBulkTest('decimal(18,4)', function(i) {
            return  (i * 10) + (i * 0.1);
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select decimal column batchSize ' + test1BatchSize, function(test_done) {
        decimalTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select decimal column batchSize ' + test2BatchSize, function(test_done) {
        decimalTest(test2BatchSize, true, test_done);
    });

    function varcharTest(batchSize, selectAfterInsert, test_done) {
        var arr = [];
        var str = '';
        for (var i = 0; i < 10; ++i) {
            str = str + i;
            arr.push(str)
        }
        simpleColumnBulkTest('varchar(100)', function (i) {
            var idx = i % 10;
            var s = arr[idx];
            return s;
        }, selectAfterInsert, batchSize, test_done)
    }

    test('bulk insert/select varchar column batchSize ' + test1BatchSize, function(test_done) {
        varcharTest(test1BatchSize, true, test_done);
    });

    test('bulk insert/select varchar column batchSize ' + test2BatchSize, function(test_done) {
        varcharTest(test2BatchSize, true, test_done);
    });

    test('bulk insert simple multi-column object in batches ' + test2BatchSize, function (test_done) {

        function buildTest(count) {
            var arr = [];
            var str = '-';
            for (var i = 0; i < count; ++i) {
                str = str + i;
                if (i % 10 === 0) str = '-';
                var inst = {
                    pkid : i,
                    num1 : i * 3,
                    num2 : i * 4,
                    num3: i % 2 === 0 ? null : i * 32,
                    st: str
                };
                arr.push(inst);
            }
            return arr;
        }

        var table_name = "BulkTest";

        testBoilerPlate( {
            name : table_name
        }, go);

        function go() {
            var tm = c.tableMgr();
            tm.bind(table_name, test);
        }

        function test(bulkMgr) {
            var batch = totalObjectsForInsert;
            var vec = buildTest(batch);
            bulkMgr.insertRows(vec, insertDone);

            function insertDone(err,res) {
                assert.ifError(err);
                assert(res.length == 0);
                var s = "select count(*) as count from " + table_name;
                c.query(s, function(err, results) {
                    var expected = [ {
                        count : batch
                    }];
                    assert.ifError(err);
                    assert.deepEqual(results, expected, "results didn't match");
                    test_done();
                });
            }
        }
    });

    function simpleColumnBulkTest(type, buildFunction, check, batchSize, test_done) {

        var table_name = 'bulkColumn';

        testBoilerPlate( {
            name : table_name,
            type : type
        }, go);

        function go() {
            tm = c.tableMgr();
            tm.bind(table_name, test);
        }

        function buildTestObjects(batch) {
            var arr = [];

            for (var i = 0; i < batch; ++i) {
                arr.push(
                    {
                        pkid : i,
                        col1 : buildFunction(i)
                    }
                )
            }
            return arr;
        }

        function test(bulkMgr) {
            bulkMgr.setBatchSize(batchSize);
            var batch = totalObjectsForInsert;
            var vec = buildTestObjects(batch);
            bulkMgr.insertRows(vec, insertDone);

            function insertDone(err,res) {
                assert.ifError(err);
                assert(res.length == 0);
                var s = "select count(*) as count from " + table_name;
                c.query(s, function(err, results) {
                    var expected = [ {
                        count : batch
                    }];
                    assert.ifError(err);
                    assert.deepEqual(results, expected, "results didn't match");
                    if (check) checkCompare(vec);
                    else test_done();
                });
            }

            function checkCompare(expected) {
                var fetch = [];
                for (var i = 0; i < expected.length; ++i) {
                    fetch.push( {
                        pkid : i
                    })
                }
                bulkMgr.selectRows(fetch, function(err, results) {
                    assert.ifError(err);
                    assert.deepEqual(results, expected, "results didn't match");
                    test_done();
                });
            }
        }
    }

    test('employee bulk operations', function (test_done) {

        var table_name = "Employee";

        testBoilerPlate( {
            name : table_name
        }, go);

        function go() {
            var tm = c.tableMgr();
            tm.bind(table_name, test);
        }

        function test(bulkMgr) {
            var keys = [];
            var parsedJSON = getJSON(keys);

            bulkMgr.insertRows(parsedJSON, insertDone);

            function insertDone(err,res) {
                assert.ifError(err);
                assert(res.length == 0);
                bulkMgr.selectRows(keys, bulkDone);
            }

            function bulkDone(err, results) {
                assert(results.length === 10);
                assert.deepEqual(results, parsedJSON, "results didn't match");
                test_done();
            }
        }
    });
});



