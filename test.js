var grok = require('./index.js');
var expect = require("chai").expect;

var patternFactory = grok.loadDefaultSync();

function testParse(p, str, expected, done) {
/*    var patt = patternFactory.createPattern(p);
    var result = patt.parseSync(str);
    expect(result).to.be.eql(expected);
    done()*/

	grok.loadDefault(function (err, patterns) {
		expect(err).to.be.null;

		var pattern = patterns.createPattern(p);
		pattern.parse(str, function (err, result) {
			expect(err).to.be.null;
			expect(result).to.be.eql(expected);
			done();
		});
	});
}

describe('grok', function() {
	describe('loadDefault', function() {
		it('is asynchronous', function() {
			var isDone = false;

			grok.loadDefault(function(patterns) {
				isDone = true;
			});

			expect(isDone, 'was done immediately after return').to.be.false;
		});
	});

	describe('#parseSync()', function () {
		it('returns null when a parse fails', function() {
			var patterns = grok.loadDefaultSync();
			var pattern = patterns.createPattern('%{WORD:verb} %{WORD:adjective}');

			var result = pattern.parseSync('test');
			expect(result).to.be.null;
		});
	});

	describe('#parse()', function () {
		
		it('is asynchronous', function(done) {
			grok.loadDefault(function (err, patterns) {
				expect(err).to.be.null;

				var pattern = patterns.createPattern('%{WORD:verb}');
				var isDone = false;

				pattern.parse('test', function(err, result) {
					isDone = true;
				});

				expect(isDone).to.be.false;
				done();
			});
		});

		it('returns null when a parse fails', function(done) {
			grok.loadDefault(function (err, patterns) {
				expect(err).to.be.null;

				var pattern = patterns.createPattern('%{WORD:verb} %{WORD:adjective}');

				pattern.parse('test', function(err, result) {
					expect(err).to.not.exist;
					expect(result).to.be.null;
					done();
				});
			});
		});

		it('parses to attributes with uppercase in their names', function(done) {
			grok.loadDefault(function (err, patterns) {
				expect(err).to.be.null;

				var pattern = patterns.createPattern('%{WORD:verb} %{WORD:testVariable}');

				pattern.parse('test worp', function(err, result) {
					expect(err).to.not.exist;
					expect(result).to.deep.equal({verb: 'test', testVariable: 'worp'});
					done();
				});
			});
		});

		it('should parse a simple custom pattern', function (done) {
			var p   = '(?<verb>\\w+)\\s+(?<url>/\\w+)';
			var str = 'DELETE /ping HTTP/1.1';
			var expected = {
				verb: 'DELETE',
				url:  '/ping'
			};

			testParse(p, str, expected, done);
		});
		
		it('should parse a pattern with some default patterns', function (done) {
			var p   = '%{WORD:verb} %{URIPATH:url}';
			var str = 'DELETE /ping HTTP/1.1';
			var expected = {
				verb: 'DELETE',
				url:  '/ping'
			};

			testParse(p, str, expected, done);
		});

		it('should parse a pattern with optional parts correctly #1', function (done) {
			var p   = '(?<all>(%{WORD:verb} %{URIPATH:url}|(?<alternative>\\(ALTERNATIVE\\))))';
			var str = 'DELETE /ping HTTP/1.1';
			var expected = {
				all: 'DELETE /ping',
				verb: 'DELETE',
				url:  '/ping'
			};

			testParse(p, str, expected, done);
		});

		it('should parse a pattern with optional parts correctly #2', function (done) {
			var p   = '(?<all>(%{WORD:verb} %{URIPATH:url}|(?<alternative>\\(ALTERNATIVE\\))))';
			var str = '(ALTERNATIVE)';
			var expected = {
				all:         '(ALTERNATIVE)',
				alternative: '(ALTERNATIVE)',
				url: null, // top layer sub pattern always emit
				verb: null
			};

			testParse(p, str, expected, done);
		});

        it('java date pattern and type convert', function (done) {
            var p   = '\\[%{CUSTOM_TIMESTAMP_ISO8601:logtime;date;yyyy-MM-dd\'T\'HH:mm:ssXXX}\\] %{IPV4:remote_addr} %{IPV4:http_x_forwarded_for} "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:httpversion})?|(-))" %{NOTSPACE:status} %{NOTSPACE:request_time:float} %{NOTSPACE:upstream_response_time:float} %{NOTSPACE:body_bytes_sent} %{NOTSPACE:upstream_addr} %{GREEDYDATA:agent}';
            var str = '[2017-08-10T16:53:20+08:00] 120.76.247.214 219.136.205.81 "GET /app/slices/query-druid?q=xxx HTTP/1.0" 200 1.741 1.741 764 192.168.0.227:8000 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.86 Safari/537.36';

            var expected = {
                agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.86 Safari/537.36",
                body_bytes_sent: "764",
                http_x_forwarded_for: "219.136.205.81",
                httpversion: "1.0",
                logtime: 1502355200000,
                remote_addr: "120.76.247.214",
                request_method: "GET",
                request_param: "?q=xxx",
                request_time: 1.741,
                request_url: "/app/slices/query-druid",
                status: "200",
                upstream_addr: "192.168.0.227:8000",
                upstream_response_time: 1.741
            };

            testParse(p, str, expected, done);
        });

        it('int datetime json type test', function (done) {
            var p   = '\\[%{DATESTAMP:logtime;datetime;MM/dd/yyyy HH:mm:ss}\\] %{IP:remote_addr} %{IPV4:http_x_forwarded_for} "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:httpversion})?|(-))" %{NOTSPACE:status:int} %{NOTSPACE:request_time:float} %{NOTSPACE:upstream_response_time:float} %{NOTSPACE:body_bytes_sent:int} %{NOTSPACE:upstream_addr} %{JSON:errObj:json}';
            var str = '[08/10/2017 16:53:20] 120.76.247.214 219.136.205.81 "GET /app/slices/query-druid?q=xxx HTTP/1.0" 200 1.741 1.741 764 192.168.0.227:8000 {"msg":"Err-msg","stack":"line 1\\nline2"}';

            var expected = {
                body_bytes_sent: 764,
                http_x_forwarded_for: "219.136.205.81",
                httpversion: "1.0",
                logtime: 1502355200000,
                remote_addr: "120.76.247.214",
                request_method: "GET",
                request_param: "?q=xxx",
                request_time: 1.741,
                request_url: "/app/slices/query-druid",
                status: 200,
                upstream_addr: "192.168.0.227:8000",
                upstream_response_time: 1.741,
				errObj: {msg: "Err-msg", stack: "line 1\nline2"}
            };

            testParse(p, str, expected, done);
        });

		it('should parse parts of the default HAPROXYHTTP pattern', function (done) {
			var p   = '(<BADREQ>|(%{WORD:http_verb} (%{URIPROTO:http_proto}://)?(?:%{USER:http_user}(?::[^@]*)?@)?(?:%{URIHOST:http_host})?(?:%{URIPATHPARAM:http_request})?( HTTP/%{NUMBER:http_version})?))';
			var str = 'GET /ping HTTP/1.1';
			var expected = {
				http_verb:                'GET',
				http_request:             '/ping',
				http_version:             '1.1',
				http_host: null, // top layer sub pattern always emit
				http_proto: null,
				http_user: null
			};

			testParse(p, str, expected, done);
		});

		it('should parse the full default HAPROXYHTTP pattern', function (done) {
			var p   = '%{HAPROXYHTTP:haproxy}';
			var str = 'Aug 17 12:06:27 minion haproxy[3274]: 1.2.3.4:50901 [17/Aug/2015:12:06:27.379] http-in backend_gru/minion_8080 1/0/0/142/265 200 259 - - ---- 0/0/0/0/0 0/0 "GET /ping HTTP/1.1"';
			var expected = {
				haproxy:                  str,
				syslog_timestamp:         'Aug 17 12:06:27',
				syslog_server:            'minion',
				pid:                      '3274',
				program:                  'haproxy',
				client_ip:                '1.2.3.4',
				client_port:              '50901',
				accept_date:              '17/Aug/2015:12:06:27.379',
				haproxy_hour:             '12',
				haproxy_milliseconds:     '379',
				haproxy_minute:           '06',
				haproxy_month:            'Aug',
				haproxy_monthday:         '17',
				haproxy_second:           '27',
				haproxy_time:             '12:06:27',
				haproxy_year:             '2015',
				frontend_name:            'http-in',
				backend_name:             'backend_gru',
				server_name:              'minion_8080',
				time_request:             '1',
				time_queue:               '0',
				time_backend_connect:     '0',
				time_backend_response:    '142',
				time_duration:            '265',
				http_status_code:         '200',
				bytes_read:               '259',
				captured_request_cookie:  '-',
				captured_response_cookie: '-',
				termination_state:        '----',
				actconn:                  '0',
				feconn:                   '0',
				beconn:                   '0',
				srvconn:                  '0',
				retries:                  '0',
				srv_queue:                '0',
				backend_queue:            '0',
				http_verb:                'GET',
				http_request:             '/ping',
				http_version:             '1.1'
			};

			testParse(p, str, expected, done);
		});

		it('should parse the sample pattern of the README.md', function (done) {
			var p   = '%{IP:client} \\[%{TIMESTAMP_ISO8601:timestamp}\\] "%{WORD:method} %{URIHOST:site}%{URIPATHPARAM:url}" %{INT:code} %{INT:request} %{INT:response} - %{NUMBER:took} \\[%{DATA:cache}\\] "%{DATA:mtag}" "%{DATA:agent}"';
			var str = '65.19.138.33 [2015-05-13T08:04:43+10:00] "GET datasymphony.com.au/ru/feed/" 304 385 0 - 0.140 [HIT] "-" "Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)"';
			var expected = {
				client:    '65.19.138.33',
				timestamp: '2015-05-13T08:04:43+10:00',
				method:    'GET',
				site:      'datasymphony.com.au',
				url:       '/ru/feed/',
				code:      '304',
				request:   '385',
				response:  '0',
				took:      '0.140',
				cache:     'HIT',
				mtag:      '-',
				agent:     'Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)'
			};

			testParse(p, str, expected, done);
		});

        it('should parse a pattern with no field name', function (done) {
            var p   = '%{WORD} %{WORD:who}';
            var str = 'hello world';
            var expected = {
                WORD: 'hello',
                who: 'world'
            };

            testParse(p, str, expected, done);
        });

        it('Not allow conflict field name', function (done) {
            var p   = '%{NOTSPACE:remote_host_name:string} %{NOTSPACE:remote_logical_username:string} %{NOTSPACE:remote_user:string} \\[%{HTTPDATE:log_time:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:http_status_code:string} %{NOTSPACE:bytes_sent:int} %{BASE16FLOAT:process_time:float} %{IPV4:local_ip_address:string} %{IPV4:remote_ip_address:string} %{NOTSPACE:request_protocol:string} %{NOTSPACE:local_port:string} %{NOTSPACE:user_session_id:string} %{URIPATH:requested_url_path:string} %{NOTSPACE:local_server_name:string} %{BASE16FLOAT:process_time:float}';
            var str = '192.168.0.125 - - [25/Aug/2017:16:32:17 +0800] "GET /favicon.ico HTTP/1.1" 200 21630 0.001 69.172.201.153 192.168.0.125 HTTP/1.1 8080 - /favicon.ico 192.168.0.202 1';

            expect(function () {
                done();
                var patt = patternFactory.createPattern(p);
                patt.parseSync(str);
            }).to.throw('Field name conflict: process_time');
        });

        it('field name not allow "-" char', function (done) {
            var p   = '%{NOTSPACE:remote_host_name:string} %{NOTSPACE:remote_log_name:string} %{NOTSPACE:remote_user:string} \\[%{HTTPDATE:log_time:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:http_status_code:string} %{BASE16NUM:body_bytes_sent_b:int} "%{GREEDYDATA:Referer}" "%{GREEDYDATA:User-agent}"';
            var str = '192.168.0.225 - - [30/Aug/2017:18:07:25 +0800] "GET /yum/SG/centos6/1.0/druid-1.0.0-bin.tar.gz HTTP/1.0" 200 161333748 "-" "Wget/1.12 (linux-gnu)"';

            expect(function () {
                done();
                var patt = patternFactory.createPattern(p);
                patt.parseSync(str);
            }).to.throw('Invalid field name: User-agent');
        });
	});
});

describe('GrokCollection', function() {
	describe('load', function() {
		it('is asynchronous', function() {
			var coll = new grok.GrokCollection();
			var isDone = false;

			coll.load(require.resolve('./patterns/grok-patterns'), function() {
				isDone = true;
			});

			expect(isDone, 'was done immediately after return').to.be.false;
		});
	});

	describe('loadSync', function() {
		it('returns number of patterns', function() {
			var coll = new grok.GrokCollection();
			var result = coll.loadSync(require.resolve('./patterns/grok-patterns'));

			expect(result, 'should match number of loaded patterns').to.equal(coll.count());
		});
	});
});

describe('Debug', function () {
    it('Test debug sub pattern match', function (done) {
        var p   = '%{IPV4:remote_addr} \\- %{NOTSPACE:remote_user} \\[%{HTTPDATE:time_local:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:status} %{BASE16NUM:body_bytes_sent:int} "%{NOTSPACE:http_referer}" "%{GREEDYDATA:http_user_agent}" (?:(?:%{IPV4}[,]?[ ]?)+|%{WORD})';
        var str = '192.168.0.112 - - [21/Apr/2017:10:55:46 +0800] "GET / HTTP/1.1" 200 612 "-" "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36" ';

        var patt = patternFactory.createPattern(p);
        var result = patt.parseSync(str);
        expect(result).to.be.eql(null);

        var debugRes = patt.debug(str);
        expect(debugRes).to.be.eql('Can not match pattern: request_param, IPV4, WORD');
        done()
    });

    it('Test debug partial regex err case 1', function (done) {
        var p   = '%{IPV4:remote_addr} \\- %{NOTSPACE:remote_user} \\[%{HTTPDATE:time_local:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:status} %{BASE16NUM:body_bytes_sent:int} "%{NOTSPACE:http_referer}" "%{GREEDYDATA:http_user_agent}" (?:(?:%{IPV4}[,]?[ ]?)+|%{WORD})';
        var str = '192.168.0.112 - - [21/Apr/2017:10:55:46 +0800] "GET / HTTP/1.1" 200 612 "-" "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36"';

        var patt = patternFactory.createPattern(p);
        var result = patt.parseSync(str);
        expect(result).to.be.eql(null);

        var debugRes = patt.debug(str);
        expect(debugRes).to.be.eql('Can not match partial regex: “" ”, at: 330, after: “%{GREEDYDATA:http_user_agent}”');
        done()
    });

    it('Test debug partial regex err case 2', function (done) {
        var p   = '%{IPV4:remote_addr} \\- %{NOTSPACE:remote_user} \\[%{HTTPDATE:time_local:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:status} %{BASE16NUM:body_bytes_sent:int} "%{NOTSPACE:http_referer}" "%{GREEDYDATA:http_user_agent}" (?:(?:%{IPV4}[,]?[ ]?)+|%{WORD})';
        var str = '192.168.0 - - [21/Apr/2017:10:55:46 +0800] "GET / HTTP/1.1" 200 612 "-" "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36"';

        var patt = patternFactory.createPattern(p);
        var result = patt.parseSync(str);
        expect(result).to.be.eql(null);

        var debugRes = patt.debug(str);
        expect(debugRes).to.be.eql('Can not match partial regex: “%{IPV4:remote_addr}”, at: 0, before: “ \\- ”');
        done()
    });

    it('Test debug partial regex err case 3', function (done) {
        var p   = '%{IPV4:remote_addr} \\- %{NOTSPACE:remote_user} \\[%{HTTPDATE:time_local:date;dd/MMM/yyyy:HH:mm:ss Z}\\] "(?:%{WORD:request_method} %{URIPATH:request_url}(?:%{URIPARAM:request_param})?(?: HTTP/%{NUMBER:http_version})?|(-))" %{NOTSPACE:status} %{BASE16NUM:body_bytes_sent:int} "%{NOTSPACE:http_referer}" "%{GREEDYDATA:http_user_agent}" (?:(?:%{IPV4}[,]?[ ]?)+|%{WORD})';
        var str = '192.168.0.1 - [21/Apr/2017:10:55:46 +0800] "GET / HTTP/1.1" 200 612 "-" "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36"';

        var patt = patternFactory.createPattern(p);
        var result = patt.parseSync(str);
        expect(result).to.be.eql(null);

        var debugRes = patt.debug(str);
        expect(debugRes).to.be.eql('Can not match partial regex: “ \\[”, at: 46, after: “%{NOTSPACE:remote_user}”');
        done()
    });
});

