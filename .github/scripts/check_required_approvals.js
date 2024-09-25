#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Загружает список измененных файлов из указанного файла.
 * @param {string} changedFilesPath - Путь к файлу со списком измененных файлов.
 * @returns {string[]} Массив путей измененных файлов.
 */
function loadChangedFiles(changedFilesPath) {
  return fs.readFileSync(changedFilesPath, 'utf-8').split('\n').filter(Boolean);
}

/**
 * Загружает правила утверждения из JSON-файла.
 * @param {string} approvalRulesPath - Путь к файлу с правилами утверждения.
 * @returns {Object} Объект с правилами утверждения.
 */
function loadApprovalRules(approvalRulesPath) {
  return JSON.parse(fs.readFileSync(approvalRulesPath, 'utf-8'));
}

/**
 * Загружает список пользователей, которые одобрили Pull Request.
 * @param {string} approvedReviewersPath - Путь к файлу со списком одобривших пользователей.
 * @returns {string[]} Массив имен одобривших пользователей.
 */
function loadApprovedReviewers(approvedReviewersPath) {
  return fs.readFileSync(approvedReviewersPath, 'utf-8').split('\n').filter(Boolean);
}

/**
 * Определяет список требуемых ответственных на основе измененных файлов и правил утверждения.
 * @param {string[]} changedFiles - Массив измененных файлов.
 * @param {Object} approvalRules - Объект с правилами утверждения.
 * @returns {string[]} Массив требуемых ответственных.
 */
function getRequiredOwners(changedFiles, approvalRules) {
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

  return Array.from(requiredOwners);
}

/**
 * Приводит имена пользователей к нижнему регистру для корректного сравнения.
 * @param {string[]} usernames - Массив имен пользователей.
 * @returns {string[]} Массив имен пользователей в нижнем регистре.
 */
function normalizeUsernames(usernames) {
  return usernames.map(name => name.toLowerCase());
}

/**
 * Получает список членов команды из GitHub API.
 * @param {string} org - Название организации на GitHub.
 * @param {string} teamSlug - "Slug" команды (название команды в URL-формате).
 * @param {string} ghToken - Токен доступа к GitHub API.
 * @returns {Promise<Object[]>} Промис с массивом объектов членов команды.
 */
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

/**
 * Проверяет, что все требуемые ответственные одобрили изменения.
 * @param {string[]} requiredOwners - Массив требуемых ответственных.
 * @param {string[]} approvedReviewers - Массив пользователей, одобривших изменения.
 * @param {string} org - Название организации на GitHub.
 * @param {string} ghToken - Токен доступа к GitHub API.
 * @param {Function} getTeamMembersFunc - Функция для получения членов команды (для тестирования).
 * @returns {Promise<boolean>} Промис с результатом проверки (true, если все одобрили).
 */
async function checkApprovals(requiredOwners, approvedReviewers, org, ghToken, getTeamMembersFunc = getTeamMembers) {
  let allRequiredApproved = true;
  const approvedReviewersNormalized = normalizeUsernames(approvedReviewers);
  const requiredOwnersNormalized = normalizeUsernames(requiredOwners);

  for (const ownerName of requiredOwnersNormalized) {
    if (ownerName.startsWith('team/')) {
      const teamSlug = ownerName.replace('team/', '');

      try {
        const teamMembers = await getTeamMembersFunc(org, teamSlug, ghToken);
        const teamMemberUsernames = teamMembers.map(member => member.login.toLowerCase());

        const approvedTeamMembers = approvedReviewersNormalized.filter(reviewer => teamMemberUsernames.includes(reviewer));

        if (approvedTeamMembers.length > 0) {
          console.log(`Апрув от команды '${teamSlug}' получен от: ${approvedTeamMembers.join(', ')}`);
        } else {
          console.log(`Ошибка: Требуемая команда '${teamSlug}' не одобрила изменения.`);
          allRequiredApproved = false;
        }
      } catch (error) {
        console.error(`Ошибка при проверке команды '${teamSlug}':`, error.message);
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

  return allRequiredApproved;
}

/**
 * Основная функция скрипта.
 */
async function main() {
  const ghToken = process.env.GH_TOKEN;
  const githubRepository = process.env.GITHUB_REPOSITORY;
  const pullNumber = process.env.PR_NUMBER;

  if (!ghToken) {
    console.error('Ошибка: Переменная окружения GH_TOKEN не установлена.');
    process.exit(1);
  }

  if (!githubRepository || !githubRepository.includes('/')) {
    console.error('Ошибка: Переменная окружения GITHUB_REPOSITORY не установлена или некорректна.');
    process.exit(1);
  }

  if (!pullNumber) {
    console.error('Ошибка: Переменная окружения PR_NUMBER не установлена.');
    process.exit(1);
  }

  const [org, repo] = githubRepository.split('/');

  // Пути к файлам
  const changedFilesPath = 'changed_files.txt';
  const approvalRulesPath = path.join(__dirname, '../approval_rules.json');
  const approvedReviewersPath = 'approved_reviewers.txt';

  // Загрузка данных
  const changedFiles = loadChangedFiles(changedFilesPath);
  const approvalRules = loadApprovalRules(approvalRulesPath);
  const approvedReviewers = loadApprovedReviewers(approvedReviewersPath);

  // Получение требуемых ответственных
  const requiredOwners = getRequiredOwners(changedFiles, approvalRules);

  if (requiredOwners.length === 0) {
    console.log('Нет правил утверждения для измененных файлов.');
    process.exit(0);
  }

  console.log(`Всего требуемых ответственных: ${requiredOwners.join(', ')}`);

  // Проверка одобрений
  const allApproved = await checkApprovals(requiredOwners, approvedReviewers, org, ghToken);

  if (!allApproved) {
    console.log('Не все требуемые ответственные одобрили изменения.');
    process.exit(1);
  } else {
    console.log('Все требуемые ответственные одобрили изменения.');
  }
}

// Запуск основной функции, если скрипт выполняется напрямую
if (require.main === module) {
  main();
}

// Экспорт функций для тестирования
module.exports = {
  loadChangedFiles,
  loadApprovalRules,
  loadApprovedReviewers,
  getRequiredOwners,
  normalizeUsernames,
  getTeamMembers,
  checkApprovals
};
