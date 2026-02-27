// @ts-check

import axios from "axios";
import { retryer } from "../common/retryer.js";
import { logger } from "../common/log.js";
import { MissingParamError } from "../common/error.js";
import { request } from "../common/http.js";

/**
 * Fetch contributor stats for a single repo via REST API.
 * Returns weekly {additions, deletions, commits} for the target user.
 *
 * @param {{ owner: string, repo: string, username: string }} variables
 * @param {string} token
 * @returns {Promise<import("axios").AxiosResponse>}
 */
const repoStatsFetcher = (variables, token) => {
  return axios({
    method: "get",
    url: `https://api.github.com/repos/${variables.owner}/${variables.repo}/stats/contributors`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${token}`,
    },
  });
};

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

  // 2. For each repo, fetch contributor stats and extract the user's data.
  /** @type {Record<number, { a: number, d: number, c: number }>} */
  const weeklyMap = {};

  for (const repo of repos) {
    try {
      let res = await retryer(repoStatsFetcher, {
        owner: repo.owner,
        repo: repo.name,
        username,
      });

      // The stats API returns 202 while computing; retry once after a delay.
      if (res.status === 202) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await retryer(repoStatsFetcher, {
          owner: repo.owner,
          repo: repo.name,
          username,
        });
      }

      if (!Array.isArray(res.data)) continue;

      const contributor = res.data.find(
        (c) => c.author && c.author.login.toLowerCase() === username.toLowerCase(),
      );
      if (!contributor) continue;

      for (const week of contributor.weeks) {
        if (week.a === 0 && week.d === 0 && week.c === 0) continue;
        if (!weeklyMap[week.w]) {
          weeklyMap[week.w] = { a: 0, d: 0, c: 0 };
        }
        weeklyMap[week.w].a += week.a;
        weeklyMap[week.w].d += week.d;
        weeklyMap[week.w].c += week.c;
      }
    } catch (err) {
      // Skip repos that fail (403, 404, etc.)
      logger.log(`Failed to fetch stats for ${repo.owner}/${repo.name}: ${err}`);
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
