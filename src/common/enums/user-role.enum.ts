enum UserRole {
  Admin = 'admin', // has full access to all features
  Member = 'member', // can view days left and request vacations
  HR = 'hr', // can manage employee data and view vacation requests
  Manager = 'manager', // approves/rejects vacation requests
  Finance = 'finance', // rates, billing reports and snapshots; no people or approvals
}

export default UserRole;
