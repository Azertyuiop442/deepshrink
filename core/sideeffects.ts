


const SIDE_EFFECT_BINARIES = new Set([
	'rm', 'mv', 'cp', 'mkdir', 'touch', 'dd', 'chmod', 'chown', 'chgrp', 'ln',
	'kill', 'pkill', 'killall', 'taskkill', 'shutdown', 'reboot', 'pmset',
	'ssh', 'scp', 'sftp', 'rsync', 'tee', 'nc', 'netcat', 'telnet', 'ping',
	'node', 'nodejs', 'python', 'python2', 'python3', 'ruby', 'perl', 'php',
	'bash', 'sh', 'zsh', 'fish', 'source', 'eval', 'exec', 'xargs',
	'open', 'watch', 'yes', 'sleep', 'time',
	'sudo', 'doas', 'launchctl', 'systemctl',
	'terraform', 'tofu', 'kubectl', 'aws', 'gcloud', 'az', 'flyctl', 'vercel', 'netlify', 'wrangler', 'supabase', 'firebase',
	'nodebrew', 'bunx', 'npx', 'pnpx', 'yarn', 'pnpm',
]);

const SIDE_EFFECT_PAIRS = new Set([
	'git push', 'git pull', 'git fetch', 'git commit', 'git reset', 'git rebase',
	'git merge', 'git checkout', 'git switch', 'git restore', 'git revert',
	'git clean', 'git cherry-pick', 'git rm', 'git stash', 'git apply', 'git am',
	'git tag', 'git branch', 'git worktree', 'git config', 'git remote',
	'npm install', 'npm i', 'npm ci', 'npm publish', 'npm unlink', 'npm link',
	'npm init', 'npm run', 'npm test', 'npm exec', 'npm start', 'npm stop',
	'yarn install', 'yarn add', 'yarn remove', 'yarn publish', 'yarn link',
	'yarn run', 'yarn test', 'yarn init',
	'pnpm install', 'pnpm add', 'pnpm remove', 'pnpm publish', 'pnpm link',
	'pnpm run', 'pnpm test', 'pnpm init', 'pnpm update',
	'bun install', 'bun add', 'bun remove', 'bun publish', 'bun link',
	'bun run', 'bun test', 'bun init', 'bun update',
	'pip install', 'pip uninstall', 'pip3 install', 'pip3 uninstall',
	'cargo install', 'cargo add', 'cargo remove', 'cargo publish',
	'cargo run', 'cargo test', 'cargo build', 'cargo bench',
	'gem install', 'gem uninstall', 'gem push',
	'brew install', 'brew uninstall', 'brew upgrade', 'brew link', 'brew unlink',
	'apt install', 'apt remove', 'apt upgrade', 'apt-get install', 'apt-get remove', 'apt-get upgrade',
	'docker build', 'docker push', 'docker pull', 'docker rm', 'docker rmi',
	'docker tag', 'docker commit', 'docker compose', 'docker system',
	'kubectl apply', 'kubectl delete', 'kubectl scale', 'kubectl rollout', 'kubectl set',
	'terraform apply', 'terraform destroy', 'tofu apply', 'tofu destroy',
	'systemctl start', 'systemctl stop', 'systemctl restart', 'systemctl enable', 'systemctl disable',
	'launchctl load', 'launchctl unload',
	'make install', 'make deploy', 'make release',
	'tail -f',
]);

const SKIP_PREFIX_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*=.*|sudo|doas|env|nohup|stdbuf|nice|command|exec|builtin|timeout)$/;
const WRITE_FLAG_RE = /(?:^|\s)(-X|--request|-d|--data|-T|--upload-file|-F|--form|-o|--output|-O|--post-data|--post-file)\b/;

export function isSideEffectCommand(cmd: string): boolean {
	const normalized = cmd.trim().replace(/\s+/g, ' ');
	if (!normalized) return false;
	const segments = normalized.split(/&&|\|\||;|\||\$\(|`|\n/);
	for (const segment of segments) {
		const tokens = segment.trim().split(' ').filter(Boolean);
		let i = 0;
		while (i < tokens.length && SKIP_PREFIX_RE.test(tokens[i])) {
			if (tokens[i] === 'timeout' && tokens[i + 1] && /^\d/.test(tokens[i + 1])) i++;
			i++;
		}
		if (i >= tokens.length) continue;
		const bin = tokens[i];
		const sub = tokens[i + 1];
		if (SIDE_EFFECT_BINARIES.has(bin)) return true;
		if (sub && SIDE_EFFECT_PAIRS.has(`${bin} ${sub}`)) return true;
		if ((bin === 'curl' || bin === 'wget') && WRITE_FLAG_RE.test(segment)) return true;
	}
	return false;
}
