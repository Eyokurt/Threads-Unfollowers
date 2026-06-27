document.addEventListener('DOMContentLoaded', () => {
  const checkPrivacy = document.getElementById('check-privacy');
  const checkLiability = document.getElementById('check-liability');
  const fileUpload = document.getElementById('file-upload');
  const uploadSection = document.getElementById('upload-section');
  const loadingState = document.getElementById('loading-state');
  const resultsSection = document.getElementById('results-section');
  const uploadError = document.getElementById('upload-error');
  const searchInput = document.getElementById('search-input');

  let parsedData = {
    notFollowingBack: [],
    fans: [],
    mutuals: []
  };

  let activeTab = 'not-following-back';

  const dropzone = document.getElementById('dropzone');

  // Drag and Drop Visual Feedback
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('border-white', 'bg-threads-hover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('border-white', 'bg-threads-hover');
    }, false);
  });

  // File processing
  fileUpload.addEventListener('change', async (e) => {
    // Hide previous errors
    uploadError.classList.add('hidden');

    if (!checkPrivacy.checked || !checkLiability.checked) {
      showError('Lütfen dosya seçmeden önce yukarıdaki gizlilik ve sorumluluk şartlarını onaylayın.');
      fileUpload.value = ''; // Reset input
      return;
    }
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      showError('Lütfen geçerli bir .zip dosyası yükleyin.');
      return;
    }

    try {
      showLoading();
      
      const zip = new JSZip();
      const zipContents = await zip.loadAsync(file);
      
      const followersData = new Map(); // username -> details
      const followingData = new Map(); // username -> details

      let foundFollowers = false;
      let foundFollowing = false;

      // Iterate through zip files
      for (const [filename, fileObj] of Object.entries(zipContents.files)) {
        if (fileObj.dir) continue;
        
        const lowerName = filename.toLowerCase();
        // Check if file is related to followers (e.g. followers_1.json, followers.html)
        if (lowerName.includes('followers') && (lowerName.endsWith('.json') || lowerName.endsWith('.html'))) {
          foundFollowers = true;
          const content = await fileObj.async('string');
          if (lowerName.endsWith('.json')) parseMetaJson(content, followersData);
          else parseMetaHtml(content, followersData);
        } 
        // Check if file is related to following
        else if (lowerName.includes('following') && (lowerName.endsWith('.json') || lowerName.endsWith('.html'))) {
          foundFollowing = true;
          const content = await fileObj.async('string');
          if (lowerName.endsWith('.json')) parseMetaJson(content, followingData);
          else parseMetaHtml(content, followingData);
        }
      }

      if (!foundFollowers || !foundFollowing) {
        throw new Error('ZIP dosyasında "followers" veya "following" verileri bulunamadı. Lütfen "Takipçiler ve takip edilenler" verisini indirdiğinizden emin olun.');
      }

      calculateRelationships(followersData, followingData);
      renderResults();
      hideLoading();

    } catch (err) {
      console.error(err);
      hideLoading();
      showError(err.message || 'Dosya işlenirken bir hata oluştu.');
    } finally {
      fileUpload.value = ''; // Reset input
    }
  });

  // Parse Meta's specific JSON structure
  function parseMetaJson(jsonString, targetMap) {
    try {
      const data = JSON.parse(jsonString);
      
      let list = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data.relationships_following) {
        list = data.relationships_following;
      } else if (data.relationships_followers) {
        list = data.relationships_followers;
      } else {
        for (const val of Object.values(data)) {
          if (Array.isArray(val)) {
            list = list.concat(val);
          }
        }
      }

      for (const item of list) {
        if (item.string_list_data && item.string_list_data.length > 0) {
          const userObj = item.string_list_data[0];
          if (userObj && userObj.value) {
            targetMap.set(userObj.value, {
              username: userObj.value,
              href: userObj.href || `https://www.instagram.com/${userObj.value}`,
              timestamp: userObj.timestamp || 0
            });
          }
        }
      }
    } catch (e) {
      console.warn('JSON parsing error for one file:', e);
    }
  }

  // Parse Meta's HTML structure
  function parseMetaHtml(htmlString, targetMap) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');
      const links = doc.querySelectorAll('a[target="_blank"]');
      
      links.forEach(a => {
        let url = a.getAttribute('href');
        if (!url) return;
        
        // Ensure it's a profile link
        if (!url.includes('threads.com') && !url.includes('threads.net') && !url.includes('instagram.com')) return;
        
        try {
          let parsedUrl = new URL(url);
          let pathParts = parsedUrl.pathname.split('/').filter(p => p);
          
          // Profile paths usually have 1 part (e.g. /username) or start with @
          if (pathParts.length === 1 || (pathParts[0] && pathParts[0].startsWith('@'))) {
            let username = pathParts[pathParts.length - 1].replace('@', '');
            
            let timestamp = 0;
            let parentDiv = a.parentElement;
            if (parentDiv && parentDiv.nextElementSibling) {
               let dateText = parentDiv.nextElementSibling.textContent;
               let parsedDate = Date.parse(dateText);
               if (!isNaN(parsedDate)) {
                 timestamp = Math.floor(parsedDate / 1000);
               }
            }
            
            targetMap.set(username, {
              username: username,
              href: `https://www.threads.net/@${username}`,
              timestamp: timestamp
            });
          }
        } catch(e) {}
      });
    } catch (e) {
      console.warn('HTML parsing error for one file:', e);
    }
  }

  function calculateRelationships(followers, following) {
    parsedData = {
      notFollowingBack: [],
      fans: [],
      mutuals: []
    };

    for (const [username, details] of following.entries()) {
      if (!followers.has(username)) {
        parsedData.notFollowingBack.push(details);
      } else {
        parsedData.mutuals.push(details);
      }
    }

    for (const [username, details] of followers.entries()) {
      if (!following.has(username)) {
        parsedData.fans.push(details);
      }
    }

    const sortFn = (a, b) => a.username.localeCompare(b.username);
    parsedData.notFollowingBack.sort(sortFn);
    parsedData.fans.sort(sortFn);
    parsedData.mutuals.sort(sortFn);
  }

  function renderResults() {
    resultsSection.classList.remove('hidden');
    resultsSection.classList.add('animate-fade-in');
    
    document.getElementById('stat-not-following-back').textContent = parsedData.notFollowingBack.length;
    document.getElementById('stat-fans').textContent = parsedData.fans.length;
    document.getElementById('stat-mutuals').textContent = parsedData.mutuals.length;

    renderList('not-following-back', parsedData.notFollowingBack);
    renderList('fans', parsedData.fans);
    renderList('mutuals', parsedData.mutuals);
  }

  function renderList(type, dataArray) {
    const ul = document.getElementById(`list-${type}`);
    ul.innerHTML = '';

    if (dataArray.length === 0) {
      ul.innerHTML = `
        <li class="py-8 text-center text-threads-muted text-sm border border-dashed border-threads-border rounded-xl mt-2">
          Bu kategoride kimse bulunamadı.
        </li>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    
    dataArray.forEach(user => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between p-3 rounded-xl hover:bg-threads-hover transition-colors group';
      li.setAttribute('data-username', user.username.toLowerCase());
      
      const dateStr = user.timestamp ? new Date(user.timestamp * 1000).toLocaleDateString('tr-TR') : '';

      li.innerHTML = `
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-10 h-10 rounded-full bg-threads-panel flex items-center justify-center shrink-0 border border-threads-border text-threads-text font-medium">
            ${user.username.charAt(0).toUpperCase()}
          </div>
          <div class="min-w-0">
            <a href="https://www.threads.com/@${user.username}" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold text-threads-text truncate hover:underline outline-none focus-visible:underline block">
              ${user.username}
            </a>
            ${dateStr ? `<p class="text-xs text-threads-muted truncate mt-0.5">Takip: ${dateStr}</p>` : ''}
          </div>
        </div>
        <a href="https://www.threads.com/@${user.username}" target="_blank" rel="noopener noreferrer" 
           class="ml-4 shrink-0 text-threads-text bg-threads-bg border border-threads-border hover:bg-threads-panel px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
           aria-label="${user.username} profiline git">
          Görüntüle
        </a>
      `;
      fragment.appendChild(li);
    });

    ul.appendChild(fragment);
  }

  // Search functionality
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const activeList = document.getElementById(`list-${activeTab}`);
    const items = activeList.querySelectorAll('li[data-username]');
    
    items.forEach(item => {
      const username = item.getAttribute('data-username');
      if (username.includes(query)) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
  });

  // Tabs logic
  const tabs = ['not-following-back', 'fans', 'mutuals'];
  tabs.forEach(tab => {
    document.getElementById(`tab-${tab}`).addEventListener('click', () => {
      // Deactivate all
      tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const panel = document.getElementById(`panel-${t}`);
        
        btn.setAttribute('aria-selected', 'false');
        btn.classList.remove('border-white', 'text-threads-text');
        btn.classList.add('border-transparent', 'text-threads-muted');
        
        panel.classList.add('hidden');
      });

      // Activate clicked
      const activeBtn = document.getElementById(`tab-${tab}`);
      const activePanel = document.getElementById(`panel-${tab}`);
      
      activeBtn.setAttribute('aria-selected', 'true');
      activeBtn.classList.remove('border-transparent', 'text-threads-muted');
      activeBtn.classList.add('border-white', 'text-threads-text');
      
      activePanel.classList.remove('hidden');
      activeTab = tab;

      // Re-trigger search for the new active tab
      searchInput.dispatchEvent(new Event('input'));
    });
  });

  // UI Helpers
  function showLoading() {
    uploadError.classList.add('hidden');
    resultsSection.classList.add('hidden');
    loadingState.classList.remove('hidden');
    loadingState.classList.add('flex');
  }

  function hideLoading() {
    loadingState.classList.add('hidden');
    loadingState.classList.remove('flex');
  }

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.classList.remove('hidden');
  }

});
