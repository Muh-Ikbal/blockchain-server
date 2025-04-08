users = [ { id: 'ikbal', connectedAt: '2025-04-08T00:52:47.606Z' } ]

findUser = (username) => {
  return users.findIndex(user => user.id === username);
}
console.log(findUser('ikbal')); // Output: 'ikbal'