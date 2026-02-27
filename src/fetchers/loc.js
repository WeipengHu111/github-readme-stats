// @ts-check

import axios from "axios";
import { retryer } from "../common/retryer.js";
import { logger } from "../common/log.js";
import { MissingParamError } from "../common/error.js";
import { request } from "../common/http.js";

/**
 * Fetch list of org repos via GraphQL.
 *
 * @param {any} variables
 * @param {string} token
 * @returns {Promise<import("axios").AxiosResponse>}
 */
const orgReposFetcher = (variables, token) => {
  return request(
    {
      query: `
      query orgRepos($login: String!) {
        organization(login: $login) {
          repositories(isFork: false, first: 100) {
            nodes { name }
          }
        }
      }
      `,
      variables,
    },
    { Authorization: `token ${token}` },
  );
};

/**
 * Fetch user's own repos via GraphQL.
 *
 * @param {any} variables
 * @param {string} token
 * @returns {Promise<import("axios").AxiosResponse>}
 */
const userReposFetcher = (variables, token) => {
  return request(
    {
      query: `
      query userRepos($login: String!) {
        user(login: $login) {
          repositories(ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], isFork: false, first: 100) {
            nodes {
              name
              owner { login }
            }
          }
        }
      }
      `,
      variables,
    },
    { Authorization: `token ${token}` },
  );
};

/**
 * @typedef {Object} WeeklyData
 * @property {number} week - Unix timestamp (start of week).
 * @property {number} additions
 * @property {number} deletions
 * @property {number} commits
 */

/**
 * @typedef {Object} LocData
 * @property {WeeklyData[]} weeklyData - Aggregated weekly data sorted by time.
 * @property {number} totalAdditions
 * @property {number} totalDeletions
 * @property {number} totalCommits
 * @property {number} netLines
 */

/**
 * Fetch LOC data for a user across all their repos + specified orgs.
 *
 * @param {string} username GitHub username.
 * @param {string} [include_orgs] Comma-separated org logins.
 * @returns {Promise<LocData>}
 */
const fetchLoc = async (username, include_orgs) => {
  if (!username) {
    throw new MissingParamError(["username"]);
  }

  // 1. Collect all repo {owner, name} pairs.
  /** @type {{ owner: string, name: string }[]} */
  let repos = [];

  // User's own repos.
  try {
    const userRes = await retryer(userReposFetcher, { login: username });
    if (userRes.data.data && userRes.data.data.user) {
      for (const node of userRes.data.data.user.repositories.nodes) {
        repos.push({ owner: node.owner.login, name: node.name });
      }
    }
  } catch (err) {
    logger.log(`Failed to fetch user repos: ${err}`);
  }

  // Org repos.
  const orgs = include_orgs
    ? include_orgs.split(",").map((o) => o.trim()).filter(Boolean)
    : [];
  for (const org of orgs) {
    try {
      const orgRes = await retryer(orgReposFetcher, { login: org });
      if (orgRes.data.data && orgRes.data.data.organization) {
        for (const node of orgRes.data.data.organization.repositories.nodes) {
          repos.push({ owner: org, name: node.name });
        }
      }
    } catch (err) {
      logger.log(`Failed to fetch org repos for ${org}: ${err}`);
    }
  }

  // Deduplicate repos by owner/name.
  const seen = new Set();
  repos = repos.filter((r) => {
    const key = `${r.owner}/${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 2. Fetch contributor stats in parallel (batches of 10).
  /** @type {Record<number, { a: number, d: number, c: number }>} */
  const weeklyMap = {};

  const token = process.env.PAT_1;

  const fetchOneRepo = async (repo) => {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/stats/contributors`;
    let res = await axios({
      method: "get", url,
      headers: { Authorization: `token ${token}` },
      timeout: 8000,
      validateStatus: () => true,
    });

    // 202 means GitHub is computing; wait briefly and retry once.
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await axios({
        method: "get", url,
        headers: { Authorization: `token ${token}` },
        timeout: 8000,
        validateStatus: () => true,
      });
    }

    if (!Array.isArray(res.data)) return null;
    return res.data.find(
      (c) => c.author && c.author.login.toLowerCase() === username.toLowerCase(),
    ) || null;
  };

  // Fire all requests in parallel.
  const results = await Promise.allSettled(repos.map(fetchOneRepo));

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const week of result.value.weeks) {
      if (week.a === 0 && week.d === 0 && week.c === 0) continue;
      if (!weeklyMap[week.w]) {
        weeklyMap[week.w] = { a: 0, d: 0, c: 0 };
      }
      weeklyMap[week.w].a += week.a;
      weeklyMap[week.w].d += week.d;
      weeklyMap[week.w].c += week.c;
    }
  }

  // 3. Build sorted weekly array.
  const weeks = Object.keys(weeklyMap)
    .map(Number)
    .sort((a, b) => a - b);

  let totalAdditions = 0;
  let totalDeletions = 0;
  let totalCommits = 0;

  /** @type {WeeklyData[]} */
  const weeklyData = weeks.map((w) => {
    const d = weeklyMap[w];
    totalAdditions += d.a;
    totalDeletions += d.d;
    totalCommits += d.c;
    return {
      week: w,
      additions: d.a,
      deletions: d.d,
      commits: d.c,
    };
  });

  return {
    weeklyData,
    totalAdditions,
    totalDeletions,
    totalCommits,
    netLines: totalAdditions - totalDeletions,
  };
};

export { fetchLoc };
export default fetchLoc;
