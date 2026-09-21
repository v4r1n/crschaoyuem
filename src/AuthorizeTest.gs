function authorizePilot_() {
  var response = UrlFetchApp.fetch(
    'https://www.googleapis.com/oauth2/v3/certs',
    { muteHttpExceptions: true }
  );
  console.log('HTTP ' + response.getResponseCode());
}
