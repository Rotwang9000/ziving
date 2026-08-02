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

	// Drift does not arrive with a commit. WINBIT32 can rebuild the Zcash
	// signer at any time and nothing here would notice until somebody
	// happened to push the site. A nightly run turns "the signer is stale"
	// from something you find out from a donor into a failed build.
	triggers {
		cron('H 5 * * *')
	}

	environment {
		DOCROOT  = '/var/www/ziving.org'
		SITE_URL = 'https://ziving.org'
		// site/lib/ is built from WINBIT32 (Zcash signer WASM + wallet-kit).
		// A Jenkins workspace is not a sibling of that checkout, so the path
		// is explicit here, as it is in WINBIT32's own pipeline for frosty-lib.
		WINBIT32_DIR = '/home/rotwang/wbdev/WINBIT32'
		NODE_BIN     = "${env.HOME}/.nvm/versions/node/v21.7.3/bin"
		PATH         = "${env.HOME}/.nvm/versions/node/v21.7.3/bin:/usr/local/bin:${env.PATH}"
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

		stage('Install') {
			// esbuild only — the site itself has no build step. The wallet
			// bundle does, and the freshness check below rebuilds it.
			steps {
				sh 'npm ci --no-audit --fund=false || npm install --no-audit --fund=false'
			}
		}

		stage('Signer Freshness') {
			// The Zcash signer in site/lib/ is consensus-critical and is a
			// COPY of WINBIT32's. Nothing used to compare the two, so the
			// copy went stale the moment somebody committed the site without
			// re-running the wallet build — and a stale signer builds
			// transactions against the wrong branch id, which the network
			// rejects for reasons the donor cannot act on.
			//
			// Two questions, both mechanical: are the committed artefacts the
			// ones WINBIT32 has now, and is the committed bundle the one a
			// fresh build produces?
			steps {
				sh '''
					set -e
					if [ ! -d "$WINBIT32_DIR" ]; then
						echo "WINBIT32_DIR=$WINBIT32_DIR missing — cannot verify signer freshness"
						exit 1
					fi

					npm run check:signer

					# The build is reproducible — same WINBIT32 inputs, same
					# bytes out, and the manifest carries no timestamp for
					# exactly this reason — so a rebuild that changes tracked
					# files means the commit shipped stale artefacts.
					npm run build:wallet
					# site/lib only: wallet/vendor is a gitignored staging copy
					# of WINBIT32's glue JS, which ends up inside the bundle.
					if ! git diff --exit-code --stat -- site/lib; then
						echo ""
						echo "DRIFT: rebuilding changed committed artefacts."
						echo "The site was committed without re-running the wallet build,"
						echo "so it ships a signer older than WINBIT32's."
						echo "Fix: npm run build:wallet && git add site/lib"
						exit 1
					fi
					echo "Committed artefacts match a fresh build."
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

					[ -s site/lib/zcash-wallet.js ] || { echo "MISSING: site/lib/zcash-wallet.js — run npm run build:wallet"; exit 1; }
					[ -s site/lib/webzjs_keys_and_send_bg.wasm ] || { echo "MISSING: webzjs wasm"; exit 1; }
					[ -s site/lib/orchard-frost/orchard_frost_wasm_bg.wasm ] || { echo "MISSING: orchard-frost wasm"; exit 1; }
					[ -s site/lib/signer-manifest.json ] || { echo "MISSING: signer-manifest.json — run npm run build:wallet"; exit 1; }

					if command -v node >/dev/null 2>&1; then
						node --check site/app.js && echo "app.js: syntax OK"
					else
						echo "WARN: node not found — skipping JS syntax check"
					fi

					grep -q "mcp.winbit32.com" site/app.js || { echo "app.js does not target the gateway"; exit 1; }
					grep -q "lib/zcash-wallet" site/app.js || { echo "wallet bundle import missing"; exit 1; }
					grep -q "resolveCampaignSlug" site/app.js || { echo "pretty URL resolver missing"; exit 1; }
					grep -q "initManage" site/app.js || { echo "manage UI missing"; exit 1; }
					echo "Validate OK"
				'''
			}
		}

		stage('Deploy → Production') {
			when {
				anyOf {
					branch 'main'
					expression { return env.JOB_NAME == 'ziving-main' }
				}
			}
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
			when {
				anyOf {
					branch 'main'
					expression { return env.JOB_NAME == 'ziving-main' }
				}
			}
			steps {
				sh '''
					set -e
					code=$(curl -s -o /tmp/ziving-smoke.html -w "%{http_code}" --max-time 20 "$SITE_URL/")
					echo "GET $SITE_URL -> $code"
					[ "$code" = "200" ] || { echo "home not 200"; exit 1; }
					grep -qi "ziving\\|shielded ZEC\\|fundraising" /tmp/ziving-smoke.html || { echo "home marker missing"; exit 1; }
					for a in styles.css app.js favicon.svg manage overlay p.html terms lib/zcash-wallet.js lib/webzjs_keys_and_send_bg.wasm; do
						c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$SITE_URL/$a")
						echo "  $a -> $c"
						[ "$c" = "200" ] || { echo "asset $a not 200"; exit 1; }
					done
					# Legacy manage URL must redirect to the clean one
					c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$SITE_URL/manage.html")
					echo "  /manage.html -> $c (expect 301)"
					[ "$c" = "301" ] || { echo "manage.html should 301 to /manage"; exit 1; }
					# Pretty URL rewrite
					c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$SITE_URL/p/smoke-test-slug")
					echo "  /p/smoke-test-slug -> $c"
					[ "$c" = "200" ] || { echo "pretty URL rewrite not 200"; exit 1; }
					# Gopher-over-HTTPS agent discovery
					c=$(curl -s -o /tmp/ziving-agent.gopher -w "%{http_code}" --max-time 20 "$SITE_URL/.well-known/agent.gopher")
					echo "  /.well-known/agent.gopher -> $c"
					[ "$c" = "200" ] || { echo "agent.gopher not 200"; exit 1; }
					grep -qi "ziving\\|MCP\\|winbit32_ziving" /tmp/ziving-agent.gopher || { echo "agent.gopher marker missing"; exit 1; }
					rm -f /tmp/ziving-smoke.html /tmp/ziving-agent.gopher
					echo "Smoke test passed"
				'''
			}
		}

		stage('Signer Landed') {
			when {
				anyOf {
					branch 'main'
					expression { return env.JOB_NAME == 'ziving-main' }
				}
			}
			// A deploy that reports success while donors keep loading the old
			// signer is the failure this whole exercise is about. Hashing what
			// the site actually serves — at the versioned URL the bundle asks
			// for — is the only check that answers it.
			steps {
				sh 'node wallet/check-signer.mjs --docroot="$DOCROOT" --url="$SITE_URL"'
			}
		}
	}

	post {
		failure { echo "ZIVING PIPELINE FAILED — ${env.BRANCH_NAME ?: env.GIT_BRANCH} #${env.BUILD_NUMBER}" }
		success { echo "Ziving pipeline OK — ${env.BRANCH_NAME ?: env.GIT_BRANCH} #${env.BUILD_NUMBER}" }
	}
}
