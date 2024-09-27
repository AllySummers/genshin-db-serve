/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { gunzip as gunzipCallback } from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(gunzipCallback);

const languages = {
	chinesesimplified: 'ChineseSimplified',
	chinesetraditional: 'ChineseTraditional',
	english: 'English',
	french: 'French',
	german: 'German',
	indonesian: 'Indonesian',
	italian: 'Italian',
	japanese: 'Japanese',
	korean: 'Korean',
	portuguese: 'Portuguese',
	russian: 'Russian',
	spanish: 'Spanish',
	thai: 'Thai',
	turkish: 'Turkish',
	vietnamese: 'Vietnamese',
} as const;

const lowercaseLanguages = Object.keys(languages);
const isLanguage = (value?: string): value is Language => typeof value === 'string' && lowercaseLanguages.includes(value.toLowerCase());

type Language = keyof typeof languages;

/*
data.genshin.pw/<language>/<category> 		- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/<pascalcase-language>/<category>.json
data.genshin.pw/<language>/<category>/index - https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/<pascalcase-language>/<category>.json
data.genshin.pw/<language>/<category>/all 	- https://raw.githubusercontent.com/theBowja/genshin-db-dist/refs/heads/main/data/gzips/<lowercase-language>-<category>.min.json.gzip
data.genshin.pw/<language>/<category>/<id> 	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/<pascalcase-language>/<category>/<id>.json

data.genshin.pw/<category>		 	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/English/<category>.json
data.genshin.pw/<category>/index 	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/English/<category>.json
data.genshin.pw/<category>/all 		- https://raw.githubusercontent.com/theBowja/genshin-db-dist/refs/heads/main/data/gzips/english-<category>.min.json.gzip
data.genshin.pw/<category>/<id> 	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/English/<category>/<id>.json

data.genshin.pw/<category>?lang=french			- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/French/<category>.json
data.genshin.pw/<category>/index?lang=french	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/index/French/category>.json
data.genshin.pw/<category>/all?lang=french 		- https://raw.githubusercontent.com/theBowja/genshin-db-dist/refs/heads/main/data/gzips/french-<category>.min.json.gzip
data.genshin.pw/<category>/<id>?lang=french 	- https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/main/src/data/French/<category>/<id>.json
*/

interface ParsedURL {
	language: Language;
	category: string;
	id: 'all' | 'index' | string;
	branch: string;
}

class InvalidURLError extends Error {
	constructor(public message: string) {
		super(message);
		this.name = 'InvalidURLError';
	}
}

/**
 * Parsed a URL string to extract the language, category, and id.
 */
const parseURL = (url: string): ParsedURL => {
	const urlObj = new URL(url);

	const [first, second, third] = urlObj.pathname.split('/').filter((part) => part !== '');

	if (typeof first !== 'string') {
		throw new InvalidURLError('Invalid URL Format');
	}

	const queryLang = urlObj.searchParams.get('lang') ?? urlObj.searchParams.get('language');
	const branch = urlObj.searchParams.get('branch') ?? 'main';

	let language: Language = 'english';
	let category: string;
	let id: 'all' | 'index' | string;

	if (isLanguage(first)) {
		language = first;
		category = second;
		id = third;
	} else {
		category = first;
		id = second;
	}

	id ??= 'index';

	if (typeof queryLang === 'string' && isLanguage(queryLang)) {
		language = queryLang;
	}

	if (!isLanguage(language)) {
		throw new InvalidURLError('Invalid Language');
	}

	return {
		language,
		category,
		id,
		branch,
	};
};

const getGitHubURL = ({ branch, language, category, id }: ParsedURL): string => {
	if (id === 'all') {
		return `https://raw.githubusercontent.com/theBowja/genshin-db-dist/refs/heads/${branch}/data/gzips/${language}-${category}.min.json.gzip`;
	}
	if (id === 'index') {
		return `https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/${branch}/src/data/index/${languages[language]}/${category}.json`;
	}

	return `https://raw.githubusercontent.com/theBowja/genshin-db/refs/heads/${branch}/src/data/${languages[language]}/${category}/${id}.json`;
};

const getErrorMessage = (err: unknown) => String(err && typeof err === 'object' && 'message' in err ? err.message : err);

const headers = {
	'Content-Type': 'application/json',
};

export default {
	async fetch(request) {
		// Extract the file path from the URL
		const parsedURL = parseURL(request.url);
		const gitHubURL = getGitHubURL(parsedURL);
		console.log({
			...parsedURL,
			gitHubURL,
		});

		if (parsedURL.id === 'all') {
			try {
				const response = await fetch(gitHubURL);

				if (!response.ok) {
					return new Response('Category name not found', { status: 404 });
				}

				const arrayBuffer = await response.arrayBuffer();
				const decompressedData = await gunzip(Buffer.from(arrayBuffer));

				return new Response(decompressedData, {
					headers,
				});
			} catch (err) {
				if (err instanceof InvalidURLError) {
					return new Response(JSON.stringify({ error: `Error: ${err.message}` }, null, 2), { status: 400, headers });
				}

				return new Response(JSON.stringify({ error: `Error: ${getErrorMessage(err)}` }, null, 2), { status: 500, headers });
			}
		}

		try {
			const response = await fetch(gitHubURL);

			if (!response.ok) {
				return new Response('File not found', { status: 404 });
			}

			const data = await response.json();

			return new Response(JSON.stringify(data, null, 2), { headers });
		} catch (err) {
			if (err instanceof InvalidURLError) {
				return new Response(JSON.stringify({ error: `Error: ${err.message}` }, null, 2), { status: 400, headers });
			}
			return new Response(JSON.stringify({ error: `Error: ${getErrorMessage(err)}` }, null, 2), { status: 500, headers });
		}
	},
} satisfies ExportedHandler<Env>;
