const path = require('path');
const {
    loadChangedFiles,
    loadApprovalRules,
    loadApprovedReviewers,
    getRequiredOwners,
    normalizeUsernames,
    checkApprovals
  } = require('./check_required_approvals');

// Мокаем функцию getTeamMembers
jest.mock('./check_required_approvals', () => {
  const originalModule = jest.requireActual('./check_required_approvals');

  return {
    __esModule: true,
    ...originalModule,
    getTeamMembers: jest.fn()
  };
});

describe('Approval Checker', () => {
  beforeEach(() => {

    process.env.GITHUB_REPOSITORY = 'my-org/my-repo';
    process.env.GH_TOKEN = 'fake-token';
    process.env.PR_NUMBER = '123';
    jest.clearAllMocks();
  });

  test('should load changed files correctly', () => {
    const changedFiles = loadChangedFiles(path.join(__dirname, 'test_data/changed_files.txt'));
    expect(changedFiles).toEqual(['app/client/header/header.js']);
  });

  test('should load approval rules correctly', () => {
    const approvalRules = loadApprovalRules(path.join(__dirname, 'test_data/approval_rules.json'));
    expect(approvalRules).toEqual({
      'app/client/footer/': ['phil2195'],
      'app/client/': ['phil397'],
      'app/': ['team/backend-devs']
    });
  });

  test('should load approved reviewers correctly', () => {
    const approvedReviewers = loadApprovedReviewers(path.join(__dirname, 'test_data/approved_reviewers.txt'));
    expect(approvedReviewers).toEqual(['phil397']);
  });

  test('should get required owners based on changed files and approval rules', () => {
    const changedFiles = ['app/client/header/header.js'];
    const approvalRules = {
      'app/client/footer/': ['phil2195'],
      'app/client/': ['phil397'],
      'app/': ['team/backend-devs']
    };
    const requiredOwners = getRequiredOwners(changedFiles, approvalRules);
    expect(requiredOwners).toEqual(['phil397', 'team/backend-devs']);
  });

  test('should normalize usernames correctly', () => {
    const usernames = ['Phil397', 'TEAM/Backend-Devs'];
    const normalized = normalizeUsernames(usernames);
    expect(normalized).toEqual(['phil397', 'team/backend-devs']);
  });

  test('should approve when required users have approved', async () => {
    const requiredOwners = ['phil397'];
    const approvedReviewers = ['phil397'];
    const org = 'my-org';
    const ghToken = 'fake-token';

    const allApproved = await checkApprovals(requiredOwners, approvedReviewers, org, ghToken);
    expect(allApproved).toBe(true);
  });

  test('should not approve when required users have not approved', async () => {
    const requiredOwners = ['phil397'];
    const approvedReviewers = ['someone_else'];
    const org = 'my-org';
    const ghToken = 'fake-token';

    const allApproved = await checkApprovals(requiredOwners, approvedReviewers, org, ghToken);
    expect(allApproved).toBe(false);
  });

  test('should approve when team member has approved', async () => {
    const requiredOwners = ['team/backend-devs'];
    const approvedReviewers = ['dev_member'];
    const org = 'my-org';
    const ghToken = 'fake-token';

    // Создаём мок-функцию для getTeamMembers
    const mockGetTeamMembers = jest.fn().mockResolvedValue([{ login: 'dev_member' }, { login: 'other_member' }]);

    const allApproved = await checkApprovals(requiredOwners, approvedReviewers, org, ghToken, mockGetTeamMembers);
    expect(allApproved).toBe(true);
    expect(mockGetTeamMembers).toHaveBeenCalledWith(org, 'backend-devs', ghToken);
  });

  test('should not approve when no team members have approved', async () => {
    const requiredOwners = ['team/backend-devs'];
    const approvedReviewers = ['someone_else'];
    const org = 'my-org';
    const ghToken = 'fake-token';

    // Создаём мок-функцию для getTeamMembers
    const mockGetTeamMembers = jest.fn().mockResolvedValue([{ login: 'dev_member' }, { login: 'other_member' }]);

    const allApproved = await checkApprovals(requiredOwners, approvedReviewers, org, ghToken, mockGetTeamMembers);
    expect(allApproved).toBe(false);
    expect(mockGetTeamMembers).toHaveBeenCalledWith(org, 'backend-devs', ghToken);
  });
});
