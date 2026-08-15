(function () {
  function getTrigger(group) {
    return Array.from(group.children).find(function (el) {
      return el.matches('button, a, [role="button"]');
    }) || null;
  }

  function getMenu(group) {
    return Array.from(group.children).find(function (el) {
      return el.classList && el.classList.contains('dropdown-content');
    }) || null;
  }

  function setExpanded(group, open) {
    var trigger = getTrigger(group);
    if (trigger) {
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function closeAll(exceptGroup) {
    document.querySelectorAll('.dropdown-group.dropdown-open').forEach(function (group) {
      if (group !== exceptGroup) {
        group.classList.remove('dropdown-open');
        setExpanded(group, false);
      }
    });
  }

  function toggleGroup(group, forceOpen) {
    var shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : !group.classList.contains('dropdown-open');
    if (shouldOpen) {
      closeAll(group);
    }
    group.classList.toggle('dropdown-open', shouldOpen);
    setExpanded(group, shouldOpen);
  }

  function initDropdownGroups() {
    var groups = Array.from(document.querySelectorAll('.dropdown-group'));
    if (!groups.length) {
      return;
    }

    groups.forEach(function (group) {
      var trigger = getTrigger(group);
      var menu = getMenu(group);
      if (!trigger || !menu) {
        return;
      }

      setExpanded(group, false);

      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleGroup(group);
      });

      trigger.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          toggleGroup(group, true);
          var firstTarget = menu.querySelector('a, button, [tabindex]:not([tabindex="-1"])');
          if (firstTarget) {
            firstTarget.focus();
          }
        } else if (event.key === 'Escape') {
          toggleGroup(group, false);
          trigger.focus();
        }
      });

      menu.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          toggleGroup(group, false);
          trigger.focus();
        }
      });
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('.dropdown-group')) {
        closeAll();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeAll();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDropdownGroups, { once: true });
  } else {
    initDropdownGroups();
  }
})();
