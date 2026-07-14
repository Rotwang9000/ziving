/*
 * Ziving CI/CD — https://ziving.org
 *
 * Branch workflow (multibranch job "ziving", source Rotwang9000/ziving):
 *   feature/* / PRs   →  CI only (validate the static site, no deploy)
 *   main (production) →  validate → deploy to /var/www/ziving.org → smoke test
 *
 * The site is plain static HTML/CSS/JS (no build step) that talks to the
 * winbit32 gateway's free /v1/ziving REST surface from the browser, so the
 * pipeline just validates and rsyncs `site/` into the docroot. Rollback =
 * re-run this job at the prior commit.
 *
 * Deploy stages are gated `when { branch 'main' }`, which only matches when
 * BRANCH_NAME is set — i.e. in this multibranch job.
 */

pipeline {
	agent any

	options {
		buildDiscarder(logRotator(numToKeepStr: '20'))
		timeout(time: 10, unit: 'MINUTES')
		timestamps()
		disableConcurrentBuilds()
	}

	environment {
		DOCROOT  = '/var/www/ziving.org'
		SITE_URL = 'https://ziving.org'
	}

	stages {

		stage('Checkout Info') {
			steps {
				sh '''
					echo "Branch:  ${BRANCH_NAME:-$GIT_BRANCH}"
					echo "Commit:  $(git rev-parse --short HEAD || echo n/a)"
				'''
			}
		}

		stage('Validate') {
			steps {
				sh '''
					set -e
					for f in site/index.html site/p.html site/manage.html site/overlay.html site/styles.css site/app.js site/favicon.svg; do
						[ -s "$f" ] || { echo "MISSING/EMPTY: $f"; exit 1; }
					done

					if command -v node >/dev/null 2>&1; then
						node --check site/app.js && echo "app.js: syntax OK"
					else
						echo "WARN: node not found — skipping JS syntax check"
					fi

					grep -q "mcp.winbit32.com" site/app.js || { echo "app.js does not target the gateway"; exit 1; }
					grep -q "resolveCampaignSlug" site/app.js || { echo "pretty URL resolver missing"; exit 1; }
					grep -q "initManage" site/app.js || { echo "manage UI missing"; exit 1; }
					echo "Validate OK"
				'''
			}
		}

		stage('Deploy → Production') {
			when { branch 'main' }
			steps {
				sh '''
					set -e
					mkdir -p "$DOCROOT"
					rsync -rl --delete --no-perms --no-group --no-owner \
						--exclude=.git site/ "$DOCROOT"/
					chmod -R a+rX "$DOCROOT"
					echo "Deployed $(git rev-parse --short HEAD) to $SITE_URL"
					ls -la "$DOCROOT"
				'''
			}
		}

		stage('Smoke Test → Production') {
			when { branch 'main' }
			steps {
				sh '''
					set -e
					code=$(curl -s -o /tmp/ziving-smoke.html -w "%{http_code}" --max-time 20 "$SITE_URL/")
					echo "GET $SITE_URL -> $code"
					[ "$code" = "200" ] || { echo "home not 200"; exit 1; }
					grep -qi "ziving\\|shielded ZEC\\|fundraising" /tmp/ziving-smoke.html || { echo "home marker missing"; exit 1; }
					for a in styles.css app.js favicon.svg manage.html overlay.html p.html; do
						c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$SITE_URL/$a")
						echo "  $a -> $c"
						[ "$c" = "200" ] || { echo "asset $a not 200"; exit 1; }
					done
					# Pretty URL rewrite
					c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$SITE_URL/p/smoke-test-slug")
					echo "  /p/smoke-test-slug -> $c"
					[ "$c" = "200" ] || { echo "pretty URL rewrite not 200"; exit 1; }
					rm -f /tmp/ziving-smoke.html
					echo "Smoke test passed"
				'''
			}
		}
	}

	post {
		failure { echo "ZIVING PIPELINE FAILED — ${env.BRANCH_NAME ?: env.GIT_BRANCH} #${env.BUILD_NUMBER}" }
		success { echo "Ziving pipeline OK — ${env.BRANCH_NAME ?: env.GIT_BRANCH} #${env.BUILD_NUMBER}" }
	}
}
