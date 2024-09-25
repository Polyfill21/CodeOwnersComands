#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Чтение списка измененных файлов
const changedFiles = fs.readFileSync('changed_files.txt', 'utf-8').split('\n').filter(Boolean);

// Загрузка правил утверждения
const approvalRulesPath = path.join(__dirname, '../approval_rules.json');
const approvalRules = JSON.parse(fs.readFileSync(approvalRulesPath, 'utf-8'));

// Чтение списка пользователей, которые одобрили PR
const approvedReviewers = fs.readFileSync('approved_reviewers.txt', 'utf-8').split('\n').filter(Boolean);

let requiredOwners = new Set();

for (const rulePath in approvalRules) {
  const owners = approvalRules[rulePath];
  console.log(`Обработка правила для пути '${rulePath}' с ответственными: ${owners.join(', ')}`);

  const matchedFiles = changedFiles.filter(file => file.startsWith(rulePath));

  if (matchedFiles.length > 0) {
    console.log(`Файлы, соответствующие правилу '${rulePath}':`);
    matchedFiles.forEach(file => console.log(file));
    owners.forEach(owner => requiredOwners.add(owner));
  } else {
    console.log(`Нет измененных файлов, соответствующих правилу для пути '${rulePath}'`);
  }
}

if (requiredOwners.size === 0) {
  console.log('Нет правил утверждения для измененных файлов.');
  process.exit(0);
}

console.log(`Всего требуемых ответственных: ${Array.from(requiredOwners).join(', ')}`);

const approvedReviewersNormalized = approvedReviewers.map(name => name.toLowerCase());
const requiredOwnersNormalized = Array.from(requiredOwners).map(name => name.toLowerCase());

let allRequiredApproved = true;

(async () => {
  const ghToken = process.env.GH_TOKEN;
  const [org, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const pullNumber = process.env.PR_NUMBER;

  if (!ghToken) {
    console.error('Ошибка: Переменная окружения GH_TOKEN не установлена.');
    process.exit(1);
  }

  if (!org || !repo) {
    console.error('Ошибка: Переменная окружения GITHUB_REPOSITORY не установлена или некорректна.');
    process.exit(1);
  }

  if (!pullNumber) {
    console.error('Ошибка: Переменная окружения PR_NUMBER не установлена.');
    process.exit(1);
  }

  for (const ownerName of requiredOwnersNormalized) {
    if (ownerName.startsWith('team/')) {
      const teamSlug = ownerName.replace('team/', '');

      const teamMembers = await getTeamMembers(org, teamSlug, ghToken);
      const teamMemberUsernames = teamMembers.map(member => member.login.toLowerCase());

      const approvedTeamMembers = approvedReviewersNormalized.filter(reviewer => teamMemberUsernames.includes(reviewer));

      if (approvedTeamMembers.length > 0) {
        console.log(`Апрув от команды '${teamSlug}' получен от: ${approvedTeamMembers.join(', ')}`);
      } else {
        console.log(`Ошибка: Требуемая команда '${teamSlug}' не одобрила изменения.`);
        allRequiredApproved = false;
      }
    } else {
      if (!approvedReviewersNormalized.includes(ownerName)) {
        console.log(`Ошибка: Требуемый пользователь '${ownerName}' не одобрил изменения.`);
        allRequiredApproved = false;
      } else {
        console.log(`Пользователь '${ownerName}' одобрил изменения.`);
      }
    }
  }

  if (!allRequiredApproved) {
    console.log('Не все требуемые ответственные одобрили изменения.');
    process.exit(1);
  } else {
    console.log('Все требуемые ответственные одобрили изменения.');
  }
})();

function getTeamMembers(org, teamSlug, ghToken) {
  return new Promise((resolve, reject) => {
    let teamMembers = [];
    let page = 1;
    const perPage = 100;

    const fetchPage = () => {
      const options = {
        hostname: 'api.github.com',
        path: `/orgs/${org}/teams/${teamSlug}/members?per_page=${perPage}&page=${page}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Node.js',
          'Authorization': `token ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.request(options, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            const data = JSON.parse(body);
            teamMembers = teamMembers.concat(data);

            if (data.length === perPage) {
              page++;
              fetchPage();
            } else {
              resolve(teamMembers);
            }
          } else {
            console.error(`Не удалось получить членов команды '${teamSlug}':`, res.statusCode, res.statusMessage);
            console.error(body);
            reject(new Error(`Не удалось получить членов команды '${teamSlug}'`));
          }
        });
      });

      req.on('error', error => {
        console.error(`Ошибка при получении членов команды '${teamSlug}':`, error.message);
        reject(error);
      });

      req.end();
    };

    fetchPage();
  });
}
